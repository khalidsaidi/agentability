#!/usr/bin/env tsx
// Runs the AI-Readiness Index: audits every domain in data/index/domains.txt
// and writes per-domain results, a leaderboard summary, and a weekly history
// snapshot (the adoption time series). Designed for GitHub Actions.

import fsp from "node:fs/promises";
import path from "node:path";
import { evaluateSite, type SiteEvaluation } from "./lib/evaluate-site";

const REPO_ROOT = path.resolve(__dirname, "..");
const DOMAINS_PATH = path.join(REPO_ROOT, "data/index/domains.txt");
// submitted.txt holds sites people asked us to audit, and reinstatements of
// domains the content filter removed by mistake. It was only ever merged by
// `npm run panel`, which the weekly run does not call — so a submission sat
// there doing nothing until someone rebuilt the panel by hand. Four hand
// reinstatements and every audit request since the issue form shipped were
// silently dropped that way. The run merges it directly now.
const SUBMITTED_PATH = path.join(REPO_ROOT, "data/index/submitted.txt");
const VERDICTS_PATH = path.join(REPO_ROOT, "data/index/classification.json");
const OVERRIDES_PATH = path.join(REPO_ROOT, "data/index/classification-overrides.json");
const RESULTS_DIR = path.join(REPO_ROOT, "data/index/results");
const SUMMARY_PATH = path.join(REPO_ROOT, "data/index/summary.json");
const HISTORY_DIR = path.join(REPO_ROOT, "data/index/history");

const CONCURRENCY = Math.max(1, Number(process.env.INDEX_CONCURRENCY || "6"));

async function main() {
  const readList = async (file: string) => {
    try {
      return (await fsp.readFile(file, "utf8"))
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l && !l.startsWith("#"));
    } catch {
      return [];
    }
  };
  const readJson = async (file: string) => {
    try {
      return JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  // A submitted domain still has to pass the content filter — a submission buys
  // an audit, not a place past the rules.
  const verdicts = await readJson(VERDICTS_PATH);
  const overrides = await readJson(OVERRIDES_PATH);
  const verdictOf = (d: string) => {
    const o = overrides[d];
    if (o !== undefined) return typeof o === "string" ? o : ((o as { verdict?: string }).verdict ?? "ok");
    const v = verdicts[d];
    return typeof v === "string" ? v : "ok";
  };
  const fromPanel = await readList(DOMAINS_PATH);
  const submitted = (await readList(SUBMITTED_PATH)).filter((d) => verdictOf(d) === "ok");
  const added = submitted.filter((d) => !fromPanel.includes(d));
  const domains = [...fromPanel, ...added];
  if (added.length) console.log(`Submitted/reinstated domains merged in: ${added.length} (${added.join(", ")})`);

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
      ucp: r.signals.ucp,
      ...(r.platform ? { platform: r.platform } : {}),
    }));

  const pct = (n: number) => (complete.length ? Math.round((n / complete.length) * 100) : 0);
  // AAPOR's rule, applied to websites: a domain whose DNS does not resolve was
  // never an eligible website, so it leaves the denominator. A site that times
  // out, loops or refuses IS eligible and IS a result — "an agent cannot use
  // this" is the sharpest answer this index produces, so it gets counted and
  // published rather than quietly dropped.
  const offline = records.filter((r) => r.status !== "complete" && (r as any).failure === "offline");
  const noResponse = records.filter((r) => r.status !== "complete" && (r as any).failure !== "offline");
  const eligible = records.length - offline.length;
  const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  const stats = {
    audited: complete.length,
    eligible,
    outOfScope: offline.length,
    unreachable: records.length - complete.length,
    noResponse: noResponse.length,
    // Of every eligible site, the share that would not answer an agent at all.
    pctNoResponse: pctOf(noResponse.length, eligible),
    noResponseBreakdown: ["timeout", "tls", "redirect-loop", "refused"].reduce(
      (acc, kind) => ({ ...acc, [kind]: noResponse.filter((r) => (r as any).failure === kind).length }),
      {} as Record<string, number>
    ),
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

  // History snapshot — the adoption time series. Per-site scores included so
  // the site can render week-over-week deltas (risers, fallers, policy flips).
  const day = new Date().toISOString().slice(0, 10);
  await fsp.writeFile(
    path.join(HISTORY_DIR, `${day}.json`),
    JSON.stringify(
      {
        date: day,
        ...stats,
        sites: leaderboard.map((r) => ({ domain: r.domain, score: r.score, posture: r.posture, paradox: r.paradox })),
      },
      null,
      1
    ),
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
