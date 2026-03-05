#!/usr/bin/env tsx

type LatestEvaluation = {
  runId: string;
  domain: string;
  status: "complete" | "running" | "failed";
  score: number;
  grade: string;
  checks?: Array<{ id: string; status: "pass" | "warn" | "fail" }>;
  workflowAnalysis?: {
    successRate: number;
    blockedCount: number;
  };
};

type TrendsResponse = {
  domain: string;
  drift: {
    status: "improving" | "regressing" | "stable";
    scoreDelta: number;
    workflowSuccessDelta: number;
    failDelta: number;
  };
};

type CliOptions = {
  domain: string;
  apiBase: string;
  minScore: number;
  maxFails: number;
  minWorkflowSuccess: number;
  maxBlockedWorkflows: number;
  allowRegressing: boolean;
  strictTrends: boolean;
};

function usage(): string {
  return [
    "Usage: pnpm ci:gate -- --domain <domain-or-origin> [options]",
    "",
    "Options:",
    "  --domain <value>                 Domain or origin to evaluate (required)",
    "  --api-base <url>                 API base URL (default: https://agentability.org)",
    "  --min-score <number>             Minimum score (default: 75)",
    "  --max-fails <number>             Maximum fail checks allowed (default: 3)",
    "  --min-workflow-success <0-1>     Minimum workflow success rate (default: 0.6)",
    "  --max-blocked-workflows <number> Maximum blocked workflows (default: 2)",
    "  --allow-regressing               Allow regressing drift status",
    "  --strict-trends                  Fail when trends endpoint is unavailable",
    "  --help                           Show this help",
  ].join("\n");
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
  return trimmed.toLowerCase();
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliOptions | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return null;
  }

  const map = new Map<string, string>();
  let allowRegressing = false;
  let strictTrends = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-regressing") {
      allowRegressing = true;
      continue;
    }
    if (arg === "--strict-trends") {
      strictTrends = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    map.set(arg, next);
    i += 1;
  }

  const domain = normalizeDomain(map.get("--domain") ?? "");
  if (!domain) {
    console.error("Missing or invalid --domain.\n");
    console.error(usage());
    process.exit(2);
  }

  return {
    domain,
    apiBase: (map.get("--api-base") ?? "https://agentability.org").replace(/\/+$/, ""),
    minScore: parseNumber(map.get("--min-score") ?? "75", 75),
    maxFails: Math.max(0, Math.floor(parseNumber(map.get("--max-fails") ?? "3", 3))),
    minWorkflowSuccess: Math.max(
      0,
      Math.min(1, parseNumber(map.get("--min-workflow-success") ?? "0.6", 0.6))
    ),
    maxBlockedWorkflows: Math.max(
      0,
      Math.floor(parseNumber(map.get("--max-blocked-workflows") ?? "2", 2))
    ),
    allowRegressing,
    strictTrends,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return (await response.json()) as T;
}

function failCount(latest: LatestEvaluation): number {
  return latest.checks?.filter((check) => check.status === "fail").length ?? 0;
}

function workflowSuccess(latest: LatestEvaluation): number {
  if (typeof latest.workflowAnalysis?.successRate === "number") {
    return latest.workflowAnalysis.successRate;
  }
  return Number((latest.score / 100).toFixed(3));
}

function blockedWorkflows(latest: LatestEvaluation): number {
  if (typeof latest.workflowAnalysis?.blockedCount === "number") {
    return latest.workflowAnalysis.blockedCount;
  }
  return failCount(latest);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;

  const latestUrl = `${options.apiBase}/v1/evaluations/${encodeURIComponent(options.domain)}/latest.json`;
  const trendsUrl = `${options.apiBase}/v1/evaluations/${encodeURIComponent(options.domain)}/trends.json?limit=6`;

  const latest = await fetchJson<LatestEvaluation>(latestUrl);
  let trends: TrendsResponse | null = null;
  let trendsError: string | null = null;
  try {
    trends = await fetchJson<TrendsResponse>(trendsUrl);
  } catch (error) {
    trendsError = error instanceof Error ? error.message : String(error);
  }

  const currentFailCount = failCount(latest);
  const currentWorkflowSuccess = workflowSuccess(latest);
  const currentBlocked = blockedWorkflows(latest);

  const violations: string[] = [];

  if (latest.status !== "complete") {
    violations.push(`latest status is ${latest.status} (must be complete)`);
  }
  if (latest.score < options.minScore) {
    violations.push(`score ${latest.score} < min-score ${options.minScore}`);
  }
  if (currentFailCount > options.maxFails) {
    violations.push(`fail count ${currentFailCount} > max-fails ${options.maxFails}`);
  }
  if (currentWorkflowSuccess < options.minWorkflowSuccess) {
    violations.push(
      `workflow success ${currentWorkflowSuccess.toFixed(3)} < min-workflow-success ${options.minWorkflowSuccess.toFixed(3)}`
    );
  }
  if (currentBlocked > options.maxBlockedWorkflows) {
    violations.push(`blocked workflows ${currentBlocked} > max-blocked-workflows ${options.maxBlockedWorkflows}`);
  }
  if (trends) {
    if (!options.allowRegressing && trends.drift.status === "regressing") {
      violations.push("drift status is regressing");
    }
  } else if (options.strictTrends) {
    violations.push("trends endpoint unavailable (--strict-trends enabled)");
  }

  console.log("Agentability CI gate");
  console.log(`Domain: ${latest.domain}`);
  console.log(`Run: ${latest.runId}`);
  console.log(`Score: ${latest.score} (${latest.grade})`);
  console.log(`Fails: ${currentFailCount}`);
  console.log(`Workflow success: ${currentWorkflowSuccess.toFixed(3)}`);
  console.log(`Blocked workflows: ${currentBlocked}`);
  if (trends) {
    console.log(
      `Drift: ${trends.drift.status} (score ${trends.drift.scoreDelta >= 0 ? "+" : ""}${trends.drift.scoreDelta}, workflow ${
        trends.drift.workflowSuccessDelta >= 0 ? "+" : ""
      }${trends.drift.workflowSuccessDelta}, fails ${trends.drift.failDelta >= 0 ? "+" : ""}${trends.drift.failDelta})`
    );
  } else {
    console.log(`Drift: unavailable (${trendsError ?? "unknown error"})`);
  }

  if (violations.length) {
    console.error("\nCI gate failed:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log("\nCI gate passed.");
}

main().catch((error) => {
  console.error("CI gate error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
