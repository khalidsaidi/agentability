#!/usr/bin/env tsx
// Drafts the day's social post from the day's episode, so there is always one
// waiting and nobody has to pick. Writes data/fieldtest/posts/<date>.md.
//
// It only ever gets facts this repo measured: the tasks, the walls the agent
// hit with their status codes, and the index score of each site it bounced off.
// Every draft is checked afterwards for length and for domains that were not in
// the brief, because a post that overstates what we measured is worse than none.
//
//   npm run post            draft from the latest episode
//   npm run post -- 2026-10-13   draft from a specific day

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const REPO_ROOT = path.resolve(__dirname, "..");
const EPISODES_DIR = path.join(REPO_ROOT, "data/fieldtest/episodes");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const SUMMARY_PATH = path.join(REPO_ROOT, "data/index/summary.json");
const POSTS_DIR = path.join(REPO_ROOT, "data/fieldtest/posts");
const MODEL = "deepseek-v4-pro";
const LIMIT = 280;

type Step = { url?: string; status?: number; wall?: string };
type Run = { title: string; outcome: string; steps?: Step[] };
type Episode = { date: string; stats: Record<string, number>; runs: Run[] };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function main() {
  const wanted = process.argv[2];
  const files = (await fsp.readdir(EPISODES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const file = wanted ? `${wanted}.json` : files[files.length - 1];
  if (!file || !fs.existsSync(path.join(EPISODES_DIR, file))) {
    console.error(`No episode found${wanted ? ` for ${wanted}` : ""}.`);
    process.exit(1);
  }
  const ep: Episode = JSON.parse(await fsp.readFile(path.join(EPISODES_DIR, file), "utf8"));

  // Every wall the agent hit, strongest evidence first: a big site that refused
  // outright is the story, a 404 on a deep link usually is not.
  const walls = new Map<string, { status: number; url: string; note: string }>();
  for (const run of ep.runs) {
    for (const s of run.steps ?? []) {
      if (!s.url || !s.status || s.status < 400) continue;
      const host = hostOf(s.url);
      if (!host) continue;
      const prev = walls.get(host);
      // Prefer a 403 (refused us) over a 404 (wrong URL), which is the honest ranking.
      if (!prev || (prev.status !== 403 && s.status === 403)) {
        walls.set(host, { status: s.status, url: s.url, note: s.wall ?? "" });
      }
    }
  }

  const summary = fs.existsSync(SUMMARY_PATH) ? JSON.parse(await fsp.readFile(SUMMARY_PATH, "utf8")) : null;
  const scoreOf = new Map<string, number>(
    (summary?.leaderboard ?? []).map((r: { domain: string; score: number }) => [r.domain, r.score])
  );

  const wallLines = [...walls.entries()]
    .map(([host, w]) => {
      const score = scoreOf.get(host);
      return {
        host,
        status: w.status,
        url: w.url,
        note: w.note,
        score,
        // A wall on a site that is in the panel is worth more: it is a site people know.
        weight: (w.status === 403 ? 2 : 1) + (score !== undefined ? 2 : 0),
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  const brief = [
    `Episode date: ${ep.date}`,
    `Tasks attempted: ${ep.stats.tasks}. Finished cleanly: ${ep.stats.completed}. Partial: ${ep.stats.partial}. Failed: ${ep.stats.failed}.`,
    `Pages read: ${ep.stats.pageVisits}. Distinct sites: ${ep.stats.domainsVisited}. Walls hit: ${ep.stats.wallsHit}. Model cost: $${ep.stats.costUsd}.`,
    "",
    "The errands the agent was given, and how each ended:",
    ...ep.runs.map((r) => `- [${r.outcome}] ${r.title}`),
    "",
    "Sites that refused or broke, with the HTTP status the agent actually received:",
    ...wallLines.map(
      (w) =>
        `- ${w.host} returned ${w.status}${w.note ? ` (${w.note})` : ""}${
          w.score !== undefined ? `; it scores ${w.score}/100 on our AI-readiness index` : ""
        }`
    ),
    summary ? `\nIndex context: ${summary.stats.audited} sites scored, average ${summary.stats.averageScore}/100, ${summary.stats.pctClosed}% closed to AI agents by policy.` : "",
  ].join("\n");

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY not set — writing the brief without drafts.");
    await write(ep.date, brief, []);
    return;
  }

  const client = new Anthropic({ apiKey, baseURL: "https://api.deepseek.com/anthropic" });
  const response = await client.messages.create({
    model: MODEL,
    // Thinking tokens come out of this budget, and the brief is long: at 1200 the
    // model spent the lot reasoning and returned no text at all, at 6000 too.
    max_tokens: 16000,
    system: [
      "You write one short social post a day for Agentability, which measures whether websites are usable by AI agents.",
      "You are given the results of today's run. Write 3 alternative posts.",
      "",
      "Hard rules:",
      `- Each post must be under ${LIMIT} characters including spaces and line breaks.`,
      "- Use ONLY facts from the brief. Never invent a site, a number, a status code or a cause.",
      "- No hashtags, no emoji, no links, no questions to the reader, no 'thread below'.",
      "- Open with the concrete finding. No throat-clearing and no 'Did you know'.",
      "",
      "What makes one of these land: an ordinary errand anybody recognises — a price, a cancel button,",
      "what time something is on, what a trial result said — that an AI could not complete because a site",
      "refused it. Name the site. Give the status code. State it flatly and let it be absurd on its own.",
      "",
      "Register to match. These are examples of the voice, not facts to reuse — never repeat their content:",
      "",
      "  I asked an AI agent two questions anyone would ask:",
      "",
      "  What does ChatGPT cost? How do I cancel it?",
      "",
      "  openai.com/chatgpt/pricing - 403",
      '  "How can I cancel my subscription" - 403',
      "",
      "  An AI company's own pricing page blocks AI agents.",
      "",
      "  ---",
      "",
      "  Today an agent tried to answer one question: what did Lilly's retatrutide trial actually show?",
      "",
      "  investor.lilly.com - 403",
      "  lilly.com/news - 403",
      "  The NEJM paper itself - 403",
      "",
      "  The results are public. The agent could not reach a single one of them.",
      "",
      "Note what those do: they set up the human errand first, then let the status codes land as a list,",
      "then close on one flat sentence. They are not a fragment and not a statistics dump. Write at that length.",
      "",
      "Make the three genuinely different in shape, not one sentence rewritten three times:",
      "  1. one vivid single failure, told as a small scene — the errand, then the door closing;",
      "  2. one built on the day's totals, where the numbers carry it;",
      "  3. one that points at an irony or a contrast between two of the findings.",
      "Vary the sentence structure between them. If all three open the same way, you have failed.",
      "",
      "Return the 3 posts separated by a line containing only ---. Nothing else: no numbering, no commentary.",
    ].join("\n"),
    messages: [{ role: "user", content: brief }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Thinking and answer share one budget, so a silent empty answer is the failure
  // mode to expect here. Say which it was rather than writing an empty file.
  if (!text) {
    const thought = response.content.filter((b) => b.type === "thinking").length;
    console.error(
      `No text returned (stop_reason=${response.stop_reason}, thinking blocks=${thought}, ` +
        `output_tokens=${response.usage?.output_tokens}). ` +
        (response.stop_reason === "max_tokens"
          ? "Raise max_tokens — reasoning consumed the whole budget."
          : "The model answered with nothing.")
    );
    await write(ep.date, brief, []);
    process.exit(1);
  }

  const knownHosts = new Set([...walls.keys(), ...scoreOf.keys()]);
  const drafts = text
    .split(/^\s*---\s*$/m)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      // Flag anything the brief did not contain, rather than trusting the draft.
      const hosts = [...new Set(d.match(/\b[a-z0-9-]+\.(?:com|org|net|co\.uk|io|gov|edu|ai|me|tv)\b/gi) ?? [])];
      const unknown = hosts.filter((h) => !knownHosts.has(h.toLowerCase()));
      return { text: d, chars: d.length, over: d.length > LIMIT, unknown };
    });

  const cost = response.usage
    ? ((response.usage.input_tokens / 1e6) * 0.28 + (response.usage.output_tokens / 1e6) * 0.42).toFixed(4)
    : "?";
  console.log(`Drafted ${drafts.length} post(s) from ${ep.date} — about $${cost}`);
  for (const d of drafts) {
    console.log(`\n[${d.chars}/${LIMIT}]${d.over ? " OVER LIMIT" : ""}${d.unknown.length ? ` UNVERIFIED: ${d.unknown.join(", ")}` : ""}`);
    console.log(d.text);
  }

  await write(ep.date, brief, drafts);
}

async function write(
  date: string,
  brief: string,
  drafts: Array<{ text: string; chars: number; over: boolean; unknown: string[] }>
) {
  await fsp.mkdir(POSTS_DIR, { recursive: true });
  const body = [
    `# Post drafts — ${date}`,
    "",
    drafts.length
      ? drafts
          .map(
            (d, i) =>
              `## Option ${i + 1} — ${d.chars}/${LIMIT} characters${d.over ? " ⚠️ OVER LIMIT" : ""}${
                d.unknown.length ? `\n\n⚠️ Mentions something not in the brief, check before posting: ${d.unknown.join(", ")}` : ""
              }\n\n\`\`\`\n${d.text}\n\`\`\``
          )
          .join("\n\n")
      : "_No drafts: DEEPSEEK_API_KEY was not set when this ran._",
    "",
    "---",
    "",
    "<details><summary>What the drafts were written from</summary>",
    "",
    "```",
    brief,
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
  const out = path.join(POSTS_DIR, `${date}.md`);
  await fsp.writeFile(out, body, "utf8");
  console.log(`\nWritten → ${path.relative(REPO_ROOT, out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
