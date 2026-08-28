#!/usr/bin/env tsx
// Runs one field-test episode: a real agent, real tasks, real websites.
// Writes data/fieldtest/episodes/{date}.json for the site builder. Designed
// for GitHub Actions (ANTHROPIC_API_KEY secret) with a hard spend ceiling.

import fsp from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runFieldTask, AGENT_MODEL, type TaskRun } from "./lib/field-agent";
import { CostBudget } from "./lib/cost-budget";
import { produceEpisodeTasks } from "./lib/episode-producer";

const REPO_ROOT = path.resolve(__dirname, "..");
const EPISODES_DIR = path.join(REPO_ROOT, "data/fieldtest/episodes");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const DOMAINS_PATH = path.join(REPO_ROOT, "data/index/domains.txt");

// Hard episode ceiling in USD, covering BOTH the producer and the agent. A
// typical episode lands near $1; this stops any runaway well before it matters.
const EPISODE_BUDGET_USD = 6;

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

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });
  await fsp.mkdir(EPISODES_DIR, { recursive: true });

  // Fully autonomous: an AI producer invents this episode's tasks from the
  // audited panel, avoiding topics covered in past episodes.
  const panelDomains = (await fsp.readFile(DOMAINS_PATH, "utf8"))
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
  const pastTitles: string[] = [];
  try {
    for (const file of (await fsp.readdir(EPISODES_DIR)).sort().reverse().slice(0, 6)) {
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
    stats: {
      tasks: runs.length,
      completed: runs.filter((r) => r.outcome === "completed").length,
      partial: runs.filter((r) => r.outcome === "partial").length,
      failed: runs.filter((r) => r.outcome === "failed").length,
      wallsHit: runs.reduce((acc, r) => acc + r.wallsHit, 0),
      pageVisits: runs.reduce((acc, r) => acc + r.steps.filter((s) => s.url).length, 0),
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
