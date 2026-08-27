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

  const byDomain = new Map<string, SiteEvaluation>();
  let done = 0;

  async function sweep(list: string[], label: string) {
    const queue = [...list];
    async function worker() {
      while (queue.length) {
        const domain = queue.shift();
        if (!domain) return;
        const record = await evaluateSite(domain);
        byDomain.set(domain, record);
        done += 1;
        console.log(
          `[${label} ${done}] ${domain} → ${record.status}` +
            (record.status === "complete"
              ? ` score=${record.score} grade=${record.grade} posture=${record.posture}${record.paradox ? " PARADOX" : ""}`
              : ` (${record.error})`)
        );
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  await sweep(domains, "pass1");

  // Transient failures are common from CI runner IPs — retry stragglers twice
  // (lower concurrency, spaced out) before giving up on them for this run.
  for (const attempt of [2, 3]) {
    const failed = domains.filter((d) => byDomain.get(d)?.status !== "complete");
    if (!failed.length) break;
    console.log(`Retry pass ${attempt}: ${failed.length} unreachable → waiting 30s`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await sweep(failed, `pass${attempt}`);
  }

  // Still unreachable after retries: carry forward the last successful audit
  // instead of silently dropping the site off the index for a week.
  const records: SiteEvaluation[] = [];
  for (const domain of domains) {
    let record = byDomain.get(domain)!;
    if (record.status !== "complete") {
      try {
        const prevRaw = await fsp.readFile(path.join(RESULTS_DIR, `${domain}.json`), "utf8");
        const prev = JSON.parse(prevRaw) as SiteEvaluation;
        if (prev.status === "complete") {
          record = { ...prev, carriedForward: true, carriedForwardAt: new Date().toISOString() };
          console.log(`Carrying forward ${domain} from ${prev.checkedAt} (unreachable this run)`);
        }
      } catch {
        // No prior successful audit — stays unreachable.
      }
    }
    records.push(record);
    await fsp.writeFile(path.join(RESULTS_DIR, `${domain}.json`), JSON.stringify(record, null, 1), "utf8");
  }

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
