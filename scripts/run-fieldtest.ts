#!/usr/bin/env tsx
// Runs one field-test episode: a real agent, real tasks, real websites.
// Writes data/fieldtest/episodes/{date}.json for the site builder. Designed
// for GitHub Actions (DEEPSEEK_API_KEY secret) with a hard spend ceiling.
//
// Both models are served by DeepSeek through its Anthropic-format endpoint, so
// the Anthropic SDK is the client and only the base URL differs.

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runFieldTask, AGENT_MODEL, type TaskRun } from "./lib/field-agent";
import { CostBudget } from "./lib/cost-budget";
import { produceEpisodeTasks, PRODUCER_MODEL } from "./lib/episode-producer";
import { evaluateSite } from "./lib/evaluate-site";
import { rootDomain, hostOf } from "./lib/domains";

const REPO_ROOT = path.resolve(__dirname, "..");
const EPISODES_DIR = path.join(REPO_ROOT, "data/fieldtest/episodes");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const DOMAINS_PATH = path.join(REPO_ROOT, "data/index/domains.txt");

// Hard episode ceiling in USD, covering BOTH the producer and the agent. A
// typical episode lands near $0.30; this stops any runaway well before it matters.
const EPISODE_BUDGET_USD = 3;

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

type Diagnosis = { domain: string; posture: string; parseable: boolean; scoreLink: boolean };

async function diagnose(domainsVisited: string[]): Promise<Diagnosis[]> {
  const out: Diagnosis[] = [];
  for (const domain of domainsVisited) {
    try {
      const raw = await fsp.readFile(path.join(RESULTS_DIR, `${domain}.json`), "utf8");
      const r = JSON.parse(raw);
      if (r.status !== "complete") continue;
      out.push({
        domain,
        posture: r.posture,
        parseable: Boolean(r.signals?.parseableText),
        scoreLink: true,
      });
    } catch {
      /* not on the index — fine */
    }
  }
  return out;
}

// One cheap call before anything runs. A rejected key, an empty credit balance,
// or an outage must stop the episode here — not surface later as ten "failed"
// tasks that the site would publish as if the agent had actually tried.
// (An exhausted balance can come back as a plain 400, so any API error aborts.)
async function preflight(client: Anthropic): Promise<void> {
  try {
    await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? error.status : "?";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::API preflight failed (${status}): ${message.slice(0, 300)}`);
    console.error("Refusing to run an episode the agent cannot actually attempt.");
    process.exit(1);
  }
}

// The producer now picks topics from the whole web, so most sites an episode
// touches are not on the audited panel and get no diagnosis. Rather than let the
// two halves of the site drift apart, audit what the agent actually met: every
// new domain is scored, written to the Index, and added to the panel so the
// weekly run keeps it fresh. Evaluation is plain HTTP — no model, no cost.
const MAX_NEW_AUDITS = 12;
// The agent reaches these as tooling, not as sites under test.
const AGENT_INFRASTRUCTURE = new Set(["duckduckgo.com", "jina.ai", "archive.org", "google.com", "bing.com"]);

// Only the sites an episode genuinely tested: the brands a task was aimed at, and
// anything that walled the agent. Every incidental link an agent follows would
// bury the results in one-off news URLs within a week.
function sitesWorthAuditing(runs: Array<TaskRun & { diagnosis: Diagnosis[] }>): string[] {
  const worth = new Set<string>();
  for (const run of runs) {
    for (const url of run.startUrls ?? []) {
      const host = hostOf(url);
      if (host) worth.add(rootDomain(host));
    }
    for (const candidate of run.candidates ?? []) worth.add(rootDomain(candidate));
    // A site that blocks the agent is exactly what the Index exists to record.
    for (const step of run.steps) {
      if (!step.botWall) continue;
      const host = hostOf(step.finalUrl || step.url);
      if (host) worth.add(rootDomain(host));
    }
  }
  return [...worth].filter((d) => d && !AGENT_INFRASTRUCTURE.has(d));
}

async function auditNewDomains(candidates: string[], panel: Set<string>): Promise<string[]> {
  const fresh = candidates
    .filter((d) => !panel.has(d))
    .filter((d) => !fs.existsSync(path.join(RESULTS_DIR, `${d}.json`)))
    .slice(0, MAX_NEW_AUDITS);
  const added: string[] = [];
  for (const domain of fresh) {
    try {
      const record = await evaluateSite(domain);
      if (record.status !== "complete") continue;
      await fsp.writeFile(path.join(RESULTS_DIR, `${domain}.json`), JSON.stringify(record, null, 1), "utf8");
      added.push(domain);
      console.log(`    audited ${domain}: ${record.score}/100 (${record.posture})`);
    } catch (error) {
      console.log(`    could not audit ${domain}: ${String((error as Error).message).slice(0, 80)}`);
    }
  }
  // Deliberately NOT added to domains.txt: the panel is a curated list of
  // well-known sites, and appending a dozen one-off hosts a day would both change
  // what the Index is and make the weekly re-audit grow without bound. The result
  // file is enough for the episode to explain why a site beat the agent.
  return added;
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY is not set.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey, baseURL: DEEPSEEK_BASE_URL });
  await preflight(client);
  await fsp.mkdir(EPISODES_DIR, { recursive: true });

  // Fully autonomous: an AI producer invents this episode's tasks from the
  // audited panel, avoiding topics covered in past episodes.
  const panelDomains = (await fsp.readFile(DOMAINS_PATH, "utf8"))
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
  const pastTitles: string[] = [];
  try {
    // Daily cadence needs a longer memory than weekly did, or the producer starts
    // repeating itself inside a fortnight.
    for (const file of (await fsp.readdir(EPISODES_DIR)).sort().reverse().slice(0, 21)) {
      if (!file.endsWith(".json")) continue;
      const ep = JSON.parse(await fsp.readFile(path.join(EPISODES_DIR, file), "utf8"));
      for (const r of ep.runs ?? []) pastTitles.push(String(r.title));
    }
  } catch {
    /* first episode */
  }
  let blockedDomains: string[] = [];
  try {
    const summary = JSON.parse(await fsp.readFile(path.join(REPO_ROOT, "data/index/summary.json"), "utf8"));
    blockedDomains = (summary.leaderboard ?? [])
      .filter((r: any) => r.posture === "closed" || r.posture === "selective")
      .map((r: any) => r.domain);
  } catch {
    /* no index yet */
  }
  const budget = new CostBudget(EPISODE_BUDGET_USD);
  const { tasks, producedBy } = await produceEpisodeTasks(client, panelDomains, blockedDomains, pastTitles, budget);
  console.log(`Episode tasks by ${producedBy}: ${tasks.map((t) => t.id).join(", ")}`);
  // At a weekly cadence a seed fallback was a rare blip. Daily, two failures in a
  // week publishes the identical canned episode twice — visibly broken, and
  // duplicate pages for search. A missing day is the cheaper failure, and failing
  // here rather than after the run saves the whole agent spend.
  if (producedBy === "seed") {
    console.error("::error::Producer fell back to seed tasks — refusing to run a canned episode. Nothing written, nothing spent on the agent.");
    process.exit(1);
  }
  const runs: Array<TaskRun & { diagnosis: Diagnosis[] }> = [];

  for (const task of tasks) {
    if (budget.exhausted) {
      console.log(`Budget exhausted — skipping remaining tasks from ${task.id} on.`);
      break;
    }
    console.log(`\n=== ${task.id}: ${task.title}`);
    const run = await runFieldTask(client, task, budget);
    const diagnosis = await diagnose(run.domainsVisited);
    runs.push({ ...run, diagnosis });
    console.log(
      `    → ${run.outcome} in ${run.steps.length} steps, ${run.wallsHit} walls, ` +
        `${run.inputTokens + run.outputTokens} tokens${run.error ? ` (${run.error})` : ""}`
    );
    if (run.answer) console.log(`    answer: ${run.answer.slice(0, 160)}`);
  }

  if (!runs.length) {
    console.error("No tasks ran — refusing to write an empty episode.");
    process.exit(1);
  }
  // An episode where the agent never loaded a single page is not a field test,
  // whatever the per-task outcomes say. Publishing it would misreport the web.
  const pageVisits = runs.reduce((acc, r) => acc + r.steps.filter((s) => s.url).length, 0);
  if (pageVisits === 0) {
    const firstError = runs.find((r) => r.error)?.error ?? "no error recorded";
    console.error(`::error::Agent loaded zero pages across ${runs.length} tasks — refusing to publish. First error: ${firstError.slice(0, 300)}`);
    process.exit(1);
  }

  // Audit the new sites this episode met, then re-run diagnosis so the episode
  // records what the Index now knows about them.
  const newlyAudited = await auditNewDomains(sitesWorthAuditing(runs), new Set(panelDomains));
  if (newlyAudited.length) {
    console.log(`Audited ${newlyAudited.length} site(s) this episode met: ${newlyAudited.join(", ")}`);
    for (const run of runs) run.diagnosis = await diagnose(run.domainsVisited);
  }

  const inputTokens = runs.reduce((acc, r) => acc + r.inputTokens, 0);
  const outputTokens = runs.reduce((acc, r) => acc + r.outputTokens, 0);
  // Real spend for the whole episode, producer included.
  const costUsd = budget.spent;

  const date = new Date().toISOString().slice(0, 10);
  const episode = {
    date,
    generatedAt: new Date().toISOString(),
    model: AGENT_MODEL,
    producedBy,
    producerModel: producedBy === "producer" ? PRODUCER_MODEL : null,
    stats: {
      tasks: runs.length,
      completed: runs.filter((r) => r.outcome === "completed").length,
      partial: runs.filter((r) => r.outcome === "partial").length,
      failed: runs.filter((r) => r.outcome === "failed").length,
      wallsHit: runs.reduce((acc, r) => acc + r.wallsHit, 0),
      pageVisits,
      domainsVisited: [...new Set(runs.flatMap((r) => r.domainsVisited))].length,
      inputTokens,
      outputTokens,
      costUsd,
    },
    runs,
  };

  const file = path.join(EPISODES_DIR, `${date}.json`);
  await fsp.writeFile(file, JSON.stringify(episode, null, 1), "utf8");
  console.log(
    `\nEpisode ${date}: ${episode.stats.completed}/${episode.stats.tasks} completed · ` +
      `${episode.stats.wallsHit} bot walls · ${episode.stats.pageVisits} page visits · ~$${costUsd} in tokens → ${file}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
