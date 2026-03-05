#!/usr/bin/env tsx

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

type EvaluateResponse = {
  runId: string;
  status: "complete" | "running" | "failed";
  reportUrl: string;
  jsonUrl: string;
  statusUrl: string;
  domain: string;
};

type RunResponse = {
  runId: string;
  domain: string;
  status: "complete" | "running" | "failed";
  siteType?: string;
  score?: number;
  grade?: string;
  checks?: Array<{ id: string; status: "pass" | "warn" | "fail" }>;
  workflowAnalysis?: {
    successRate?: number;
    blockedCount?: number;
  };
  error?: string;
  createdAt?: string;
  completedAt?: string;
};

type BenchmarkRecord = {
  inputDomain: string;
  origin: string;
  requestId: number;
  benchmarkWorker: string;
  attempts: number;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  requestStatus: number;
  runId?: string;
  finalStatus?: RunResponse["status"];
  siteType?: string;
  score?: number;
  grade?: string;
  failCount?: number;
  warnCount?: number;
  workflowSuccessRate?: number;
  blockedWorkflows?: number;
  error?: string;
};

type CliOptions = {
  apiBase: string;
  listUrl: string;
  count: number;
  concurrency: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  outDir: string;
  spoofIp: boolean;
  benchmarkKey: string;
  benchmarkWorkers: number;
  workflowMode: "site-aware" | "legacy";
  maxAttempts: number;
  retryBaseMs: number;
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
    apiBase: (opts.get("--api-base") ?? "https://agentability.org").replace(/\/+$/, ""),
    listUrl:
      opts.get("--list-url") ??
      "https://raw.githubusercontent.com/opendns/public-domain-lists/master/opendns-top-domains.txt",
    count: Math.max(1, Number(opts.get("--count") ?? "1000") || 1000),
    concurrency: Math.max(1, Number(opts.get("--concurrency") ?? "8") || 8),
    pollIntervalMs: Math.max(500, Number(opts.get("--poll-interval-ms") ?? "2500") || 2500),
    pollTimeoutMs: Math.max(5000, Number(opts.get("--poll-timeout-ms") ?? "120000") || 120000),
    outDir: opts.get("--out-dir") ?? path.join("test-results", `prod-benchmark-${now}`),
    spoofIp: opts.get("--spoof-ip") !== "false",
    benchmarkKey: opts.get("--benchmark-key") ?? process.env.BENCHMARK_RATE_LIMIT_KEY ?? "",
    benchmarkWorkers: Math.max(1, Number(opts.get("--benchmark-workers") ?? "24") || 24),
    workflowMode: opts.get("--workflow-mode") === "legacy" ? "legacy" : "site-aware",
    maxAttempts: Math.max(1, Number(opts.get("--max-attempts") ?? "3") || 3),
    retryBaseMs: Math.max(100, Number(opts.get("--retry-base-ms") ?? "1200") || 1200),
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
    if (!response.ok) {
      throw new Error(`Failed to fetch list ${listUrl}: HTTP ${response.status}`);
    }
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
    throw new Error(`Only found ${unique.length} valid domains from ${listUrl}, need ${count}`);
  }
  return unique;
}

function randomPublicIp(seed: number): string {
  const a = 11 + (seed % 200);
  const b = (seed * 37) % 255;
  const c = (seed * 91) % 255;
  const d = 1 + (seed * 53) % 253;
  return `${a}.${b}.${c}.${d}`;
}

async function postEvaluate(
  apiBase: string,
  origin: string,
  spoofIp: boolean,
  requestId: number,
  benchmarkKey: string,
  benchmarkWorker: string,
  workflowMode: CliOptions["workflowMode"]
): Promise<{ status: number; body: EvaluateResponse | { message?: string; code?: string } }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (benchmarkKey) {
    headers["x-agentability-benchmark-key"] = benchmarkKey;
    headers["x-agentability-benchmark-worker"] = benchmarkWorker;
  }
  if (spoofIp) {
    headers["x-forwarded-for"] = randomPublicIp(requestId);
  }
  const requestBody: {
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
    requestBody.targetWorkflows = [
      "Discover product docs and entrypoints",
      "Call a public API endpoint",
      "Run a reliable automated action",
    ];
  }

  const response = await fetch(`${apiBase}/v1/evaluate`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  const responseBody = (await response.json().catch(() => ({}))) as
    | EvaluateResponse
    | { message?: string; code?: string };
  return { status: response.status, body: responseBody };
}

async function fetchRun(apiBase: string, runId: string): Promise<RunResponse> {
  const response = await fetch(`${apiBase}/v1/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`Run fetch failed: HTTP ${response.status}`);
  }
  return (await response.json()) as RunResponse;
}

async function waitForRun(
  apiBase: string,
  runId: string,
  pollIntervalMs: number,
  pollTimeoutMs: number
): Promise<RunResponse> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const run = await fetchRun(apiBase, runId);
    if (run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Run poll timeout");
}

function failWarnCounts(run: RunResponse): { failCount: number; warnCount: number } {
  const failCount = run.checks?.filter((check) => check.status === "fail").length ?? 0;
  const warnCount = run.checks?.filter((check) => check.status === "warn").length ?? 0;
  return { failCount, warnCount };
}

async function runSingleAttempt(
  domain: string,
  requestId: number,
  benchmarkWorker: string,
  options: CliOptions,
  attempt: number
): Promise<BenchmarkRecord> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const origin = `https://${domain}`;

  try {
    const evaluated = await postEvaluate(
      options.apiBase,
      origin,
      options.spoofIp,
      requestId,
      options.benchmarkKey,
      benchmarkWorker,
      options.workflowMode
    );
    if (evaluated.status !== 200) {
      const errorBody = evaluated.body as { message?: string; code?: string };
      const finished = Date.now();
      return {
        inputDomain: domain,
        origin,
        requestId,
        benchmarkWorker,
        attempts: attempt,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        elapsedMs: finished - started,
        requestStatus: evaluated.status,
        error: errorBody.message ?? errorBody.code ?? `evaluate HTTP ${evaluated.status}`,
      };
    }

    const evalBody = evaluated.body as EvaluateResponse;
    const run =
      evalBody.status === "running"
        ? await waitForRun(
            options.apiBase,
            evalBody.runId,
            options.pollIntervalMs,
            options.pollTimeoutMs
          )
        : await fetchRun(options.apiBase, evalBody.runId);

    const finished = Date.now();
    const counts = failWarnCounts(run);
    return {
      inputDomain: domain,
      origin,
      requestId,
      benchmarkWorker,
      attempts: attempt,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      elapsedMs: finished - started,
      requestStatus: evaluated.status,
      runId: run.runId,
      finalStatus: run.status,
      siteType: run.siteType,
      score: run.score,
      grade: run.grade,
      failCount: counts.failCount,
      warnCount: counts.warnCount,
      workflowSuccessRate: run.workflowAnalysis?.successRate,
      blockedWorkflows: run.workflowAnalysis?.blockedCount,
      error: run.status === "failed" ? run.error ?? "run failed" : undefined,
    };
  } catch (error) {
    const finished = Date.now();
    return {
      inputDomain: domain,
      origin,
      requestId,
      benchmarkWorker,
      attempts: attempt,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      elapsedMs: finished - started,
      requestStatus: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function shouldRetry(record: BenchmarkRecord): boolean {
  if (record.finalStatus === "complete") return false;
  if (record.requestStatus === 429) return true;
  if (record.requestStatus >= 500) return true;
  const error = (record.error ?? "").toLowerCase();
  return (
    error.includes("run poll timeout") ||
    error.includes("timeout") ||
    error.includes("503") ||
    error.includes("502") ||
    error.includes("network")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSingle(
  domain: string,
  requestId: number,
  benchmarkWorker: string,
  options: CliOptions
): Promise<BenchmarkRecord> {
  let lastRecord: BenchmarkRecord | undefined;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const record = await runSingleAttempt(domain, requestId, benchmarkWorker, options, attempt);
    lastRecord = record;
    if (!shouldRetry(record) || attempt >= options.maxAttempts) {
      return record;
    }
    const jitter = Math.floor(Math.random() * 350);
    const backoff = Math.min(10000, options.retryBaseMs * 2 ** (attempt - 1) + jitter);
    await sleep(backoff);
  }
  if (!lastRecord) {
    throw new Error("runSingle exhausted retries without producing a record");
  }
  return lastRecord;
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
    `Benchmark start: count=${options.count} concurrency=${options.concurrency} api=${options.apiBase} spoofIp=${options.spoofIp} benchmarkWorkers=${options.benchmarkWorkers} benchmarkKey=${options.benchmarkKey ? "set" : "unset"} workflowMode=${options.workflowMode} maxAttempts=${options.maxAttempts}`
  );

  const domains = await fetchDomains(options.listUrl, options.count);
  console.log(`Loaded ${domains.length} domains from ${options.listUrl}`);

  let nextIndex = 0;
  let completed = 0;
  const records: BenchmarkRecord[] = [];

  const workers = Array.from({ length: options.concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= domains.length) break;

      const domain = domains[index];
      const workerId = `w${String((index % options.benchmarkWorkers) + 1).padStart(3, "0")}`;
      const record = await runSingle(domain, index + 1, workerId, options);
      records.push(record);
      recordsStream.write(`${JSON.stringify(record)}\n`);

      completed += 1;
      if (completed % 25 === 0 || completed === domains.length) {
        const ok = records.filter((r) => r.finalStatus === "complete").length;
        const failed = records.filter(
          (r) => r.finalStatus === "failed" || (!r.finalStatus && Boolean(r.error))
        ).length;
        console.log(`Progress ${completed}/${domains.length} | complete=${ok} failed=${failed}`);
      }
    }
  });

  await Promise.all(workers);
  recordsStream.end();

  const complete = records.filter((r) => r.finalStatus === "complete");
  const failed = records.filter((r) => r.finalStatus === "failed");
  const requestErrors = records.filter((r) => !r.finalStatus && Boolean(r.error));
  const retried = records.filter((r) => r.attempts > 1);
  const retryRecovered = retried.filter((r) => r.finalStatus === "complete");
  const scores = complete
    .map((r) => r.score)
    .filter((value): value is number => typeof value === "number");
  const workflowRates = complete
    .map((r) => r.workflowSuccessRate)
    .filter((value): value is number => typeof value === "number");
  const elapsed = records.map((r) => r.elapsedMs);

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: options.apiBase,
    listUrl: options.listUrl,
    requestedCount: domains.length,
    benchmark: {
      workers: options.benchmarkWorkers,
      benchmarkKeyConfigured: Boolean(options.benchmarkKey),
      spoofIp: options.spoofIp,
      workflowMode: options.workflowMode,
      maxAttempts: options.maxAttempts,
      retryBaseMs: options.retryBaseMs,
    },
    results: {
      complete: complete.length,
      failed: failed.length,
      requestErrors: requestErrors.length,
      retried: retried.length,
      retryRecovered: retryRecovered.length,
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
    siteTypes: Object.entries(
      complete.reduce<Record<string, { count: number; scoreSum: number; workflowSum: number }>>((acc, row) => {
        const key = row.siteType || "unknown";
        if (!acc[key]) {
          acc[key] = { count: 0, scoreSum: 0, workflowSum: 0 };
        }
        acc[key].count += 1;
        acc[key].scoreSum += row.score ?? 0;
        acc[key].workflowSum += row.workflowSuccessRate ?? 0;
        return acc;
      }, {})
    )
      .map(([siteType, stats]) => ({
        siteType,
        count: stats.count,
        share: Number((stats.count / Math.max(1, complete.length)).toFixed(4)),
        meanScore: Number((stats.scoreSum / Math.max(1, stats.count)).toFixed(3)),
        meanWorkflowSuccessRate: Number((stats.workflowSum / Math.max(1, stats.count)).toFixed(4)),
      }))
      .sort((a, b) => b.count - a.count),
    output: {
      recordsPath,
      summaryPath,
    },
  };

  await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Benchmark complete. Summary written to ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
