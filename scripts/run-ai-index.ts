#!/usr/bin/env tsx
// Runs the AI-Readiness Index: audits every domain in data/index/domains.txt
// and writes per-domain results, a leaderboard summary, and a weekly history
// snapshot (the adoption time series). Designed for GitHub Actions.

import fsp from "node:fs/promises";
import path from "node:path";
import { evaluateSite, type SiteEvaluation } from "./lib/evaluate-site";

const REPO_ROOT = path.resolve(__dirname, "..");
const DOMAINS_PATH = path.join(REPO_ROOT, "data/index/domains.txt");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const SUMMARY_PATH = path.join(REPO_ROOT, "data/index/summary.json");
const HISTORY_DIR = path.join(REPO_ROOT, "data/index/history");

const CONCURRENCY = Math.max(1, Number(process.env.INDEX_CONCURRENCY || "6"));

async function main() {
  const raw = await fsp.readFile(DOMAINS_PATH, "utf8");
  const domains = raw
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));

  await fsp.mkdir(RESULTS_DIR, { recursive: true });
  await fsp.mkdir(HISTORY_DIR, { recursive: true });

  const queue = [...domains];
  const records: SiteEvaluation[] = [];
  let done = 0;

  async function worker() {
    while (queue.length) {
      const domain = queue.shift();
      if (!domain) return;
      const record = await evaluateSite(domain);
      records.push(record);
      done += 1;
      console.log(
        `[${done}/${domains.length}] ${domain} → ${record.status}` +
          (record.status === "complete"
            ? ` score=${record.score} grade=${record.grade} posture=${record.posture}${record.paradox ? " PARADOX" : ""}`
            : ` (${record.error})`)
      );
      await fsp.writeFile(path.join(RESULTS_DIR, `${domain}.json`), JSON.stringify(record, null, 1), "utf8");
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const complete = records.filter((r) => r.status === "complete");
  const leaderboard = complete
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))
    .map((r, i) => ({
      rank: i + 1,
      domain: r.domain,
      score: r.score,
      grade: r.grade,
      posture: r.posture,
      paradox: r.paradox,
      llmsTxt: r.signals.llmsTxt,
      mcp: r.signals.mcp,
    }));

  const pct = (n: number) => (complete.length ? Math.round((n / complete.length) * 100) : 0);
  const stats = {
    audited: complete.length,
    unreachable: records.length - complete.length,
    averageScore: complete.length
      ? Math.round(complete.reduce((acc, r) => acc + r.score, 0) / complete.length)
      : 0,
    pctLlmsTxt: pct(complete.filter((r) => r.signals.llmsTxt).length),
    pctMcp: pct(complete.filter((r) => r.signals.mcp).length),
    pctStructuredData: pct(complete.filter((r) => r.signals.structuredData).length),
    pctBlockingSomeAI: pct(complete.filter((r) => r.posture !== "open").length),
    pctClosed: pct(complete.filter((r) => r.posture === "closed").length),
    paradoxCount: complete.filter((r) => r.paradox).length,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    domainsRequested: domains.length,
    stats,
    unreachable: records.filter((r) => r.status !== "complete").map((r) => r.domain).sort(),
    leaderboard,
  };
  await fsp.writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 1), "utf8");

  // Weekly history snapshot — the adoption time series.
  const day = new Date().toISOString().slice(0, 10);
  await fsp.writeFile(
    path.join(HISTORY_DIR, `${day}.json`),
    JSON.stringify({ date: day, ...stats }, null, 1),
    "utf8"
  );

  console.log(
    `Index complete: ${complete.length}/${domains.length} audited · avg ${stats.averageScore} · llms.txt ${stats.pctLlmsTxt}% · blocking AI ${stats.pctBlockingSomeAI}% · paradox ${stats.paradoxCount}`
  );
  if (!complete.length) {
    console.error("No successful audits — refusing to publish an empty index.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
