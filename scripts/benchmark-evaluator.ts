#!/usr/bin/env tsx

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { evaluatePublic } from "@agentability/evaluator";

type RecordRow = {
  domain: string;
  origin: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  status: "complete" | "timeout" | "error";
  score?: number;
  grade?: string;
  failCount?: number;
  warnCount?: number;
  workflowSuccessRate?: number;
  blockedWorkflows?: number;
  error?: string;
};

type CliOptions = {
  listUrl: string;
  count: number;
  concurrency: number;
  timeoutMs: number;
  outDir: string;
  workflowMode: "site-aware" | "legacy";
};

function parseArgs(argv: string[]): CliOptions {
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    opts.set(arg, next);
    i += 1;
  }
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    listUrl:
      opts.get("--list-url") ??
      "https://raw.githubusercontent.com/opendns/public-domain-lists/master/opendns-top-domains.txt",
    count: Math.max(1, Number(opts.get("--count") ?? "1000") || 1000),
    concurrency: Math.max(1, Number(opts.get("--concurrency") ?? "20") || 20),
    timeoutMs: Math.max(1000, Number(opts.get("--timeout-ms") ?? "30000") || 30000),
    outDir: opts.get("--out-dir") ?? path.join("test-results", `evaluator-benchmark-${now}`),
    workflowMode: opts.get("--workflow-mode") === "legacy" ? "legacy" : "site-aware",
  };
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return null;
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) return null;
  return trimmed;
}

async function fetchDomains(listUrl: string, count: number): Promise<string[]> {
  let text = "";
  if (listUrl.startsWith("file://")) {
    const filePath = listUrl.slice("file://".length);
    text = await fsp.readFile(filePath, "utf8");
  } else if (!/^https?:\/\//i.test(listUrl) && fs.existsSync(listUrl)) {
    text = await fsp.readFile(listUrl, "utf8");
  } else {
    const response = await fetch(listUrl);
    if (!response.ok) throw new Error(`Failed to fetch list ${listUrl}: HTTP ${response.status}`);
    text = await response.text();
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const domain = normalizeDomain(line);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    unique.push(domain);
    if (unique.length >= count) break;
  }
  if (unique.length < count) {
    throw new Error(`Only found ${unique.length} domains; need ${count}`);
  }
  return unique;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function evaluateOne(
  domain: string,
  timeoutMs: number,
  workflowMode: CliOptions["workflowMode"]
): Promise<RecordRow> {
  const origin = `https://${domain}`;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const payload: {
      origin: string;
      profile: "auto";
      framework: "generic";
      targetWorkflows?: string[];
    } = {
      origin,
      profile: "auto",
      framework: "generic",
    };
    if (workflowMode === "legacy") {
      payload.targetWorkflows = [
        "Discover product docs and entrypoints",
        "Call a public API endpoint",
        "Run a reliable automated action",
      ];
    }

    const output = await withTimeout(
      evaluatePublic(payload),
      timeoutMs
    );
    const finished = Date.now();
    const failCount = output.result.checks.filter((check) => check.status === "fail").length;
    const warnCount = output.result.checks.filter((check) => check.status === "warn").length;
    return {
      domain,
      origin,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      elapsedMs: finished - started,
      status: "complete",
      score: output.result.score,
      grade: output.result.grade,
      failCount,
      warnCount,
      workflowSuccessRate: output.result.workflowAnalysis?.successRate,
      blockedWorkflows: output.result.workflowAnalysis?.blockedCount,
    };
  } catch (error) {
    const finished = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    return {
      domain,
      origin,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      elapsedMs: finished - started,
      status: message === "timeout" ? "timeout" : "error",
      error: message,
    };
  }
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await fsp.mkdir(options.outDir, { recursive: true });
  const recordsPath = path.join(options.outDir, "records.jsonl");
  const summaryPath = path.join(options.outDir, "summary.json");
  const recordsStream = fs.createWriteStream(recordsPath, { flags: "w" });

  console.log(
    `Evaluator benchmark start: count=${options.count} concurrency=${options.concurrency} timeoutMs=${options.timeoutMs} workflowMode=${options.workflowMode}`
  );
  const domains = await fetchDomains(options.listUrl, options.count);
  console.log(`Loaded ${domains.length} domains from ${options.listUrl}`);

  let next = 0;
  let completed = 0;
  const records: RecordRow[] = [];

  const workers = Array.from({ length: options.concurrency }, async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= domains.length) break;
      const row = await evaluateOne(domains[idx], options.timeoutMs, options.workflowMode);
      records.push(row);
      recordsStream.write(`${JSON.stringify(row)}\n`);
      completed += 1;
      if (completed % 25 === 0 || completed === domains.length) {
        const ok = records.filter((r) => r.status === "complete").length;
        const timeout = records.filter((r) => r.status === "timeout").length;
        const err = records.filter((r) => r.status === "error").length;
        console.log(`Progress ${completed}/${domains.length} | complete=${ok} timeout=${timeout} error=${err}`);
      }
    }
  });
  await Promise.all(workers);
  recordsStream.end();

  const complete = records.filter((r) => r.status === "complete");
  const timeout = records.filter((r) => r.status === "timeout");
  const error = records.filter((r) => r.status === "error");
  const scores = complete
    .map((r) => r.score)
    .filter((value): value is number => typeof value === "number");
  const elapsed = records.map((r) => r.elapsedMs);
  const workflowRates = complete
    .map((r) => r.workflowSuccessRate)
    .filter((value): value is number => typeof value === "number");

  const summary = {
    generatedAt: new Date().toISOString(),
    listUrl: options.listUrl,
    requestedCount: domains.length,
    results: {
      complete: complete.length,
      timeout: timeout.length,
      error: error.length,
    },
    benchmark: {
      workflowMode: options.workflowMode,
    },
    score: {
      mean: Number(mean(scores).toFixed(3)),
      p50: Number(percentile(scores, 0.5).toFixed(3)),
      p90: Number(percentile(scores, 0.9).toFixed(3)),
      p99: Number(percentile(scores, 0.99).toFixed(3)),
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
    },
    workflowSuccessRate: {
      mean: Number(mean(workflowRates).toFixed(4)),
      p50: Number(percentile(workflowRates, 0.5).toFixed(4)),
      p90: Number(percentile(workflowRates, 0.9).toFixed(4)),
      p99: Number(percentile(workflowRates, 0.99).toFixed(4)),
      min: workflowRates.length ? Math.min(...workflowRates) : null,
      max: workflowRates.length ? Math.max(...workflowRates) : null,
    },
    elapsedMs: {
      mean: Number(mean(elapsed).toFixed(1)),
      p50: Number(percentile(elapsed, 0.5).toFixed(1)),
      p90: Number(percentile(elapsed, 0.9).toFixed(1)),
      p99: Number(percentile(elapsed, 0.99).toFixed(1)),
      min: elapsed.length ? Math.min(...elapsed) : null,
      max: elapsed.length ? Math.max(...elapsed) : null,
    },
    output: {
      recordsPath,
      summaryPath,
    },
  };

  await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Evaluator benchmark complete. Summary written to ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
