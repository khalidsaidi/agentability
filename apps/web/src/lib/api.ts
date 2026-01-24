import type { DiffSummary, EvaluationResult, PillarScores } from "@agentability/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const SITE_BASE =
  import.meta.env.VITE_SITE_URL ??
  (API_BASE ? API_BASE.replace(/\/v1\/?$/, "") : "");

export type EvaluateResponse = {
  runId: string;
  status: "complete" | "running";
  reportUrl: string;
  jsonUrl: string;
  statusUrl: string;
  domain: string;
};

export type PreviousSummary = {
  score: number;
  grade: string;
  pillarScores: PillarScores;
  completedAt?: string;
};

export type LatestEvaluation = EvaluationResult & {
  previousRunId?: string;
  diff?: DiffSummary;
  previousSummary?: PreviousSummary;
};

export type DiscoveryAudit = {
  live_checked_at?: string;
  strict_pretty?: boolean;
  live_sources?: string[];
  discoverability_health?: {
    status: "pass" | "degraded" | "fail";
    missing?: string[];
    unreachable?: string[];
    hash_mismatch_required?: string[];
    hash_mismatch_optional?: string[];
  };
};

export async function evaluateOrigin(origin: string, profile?: string): Promise<EvaluateResponse> {
  const response = await fetch(`${API_BASE}/v1/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ origin, profile }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Evaluation failed");
  }
  return response.json();
}

export async function fetchRun(runId: string): Promise<EvaluationResult> {
  const response = await fetch(`${API_BASE}/v1/runs/${runId}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Run not found");
  }
  return response.json();
}

export async function fetchLatest(domain: string): Promise<LatestEvaluation> {
  const response = await fetch(`${API_BASE}/v1/evaluations/${domain}/latest.json`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Evaluation not found");
  }
  return response.json();
}

export async function fetchDiscoveryAudit(): Promise<DiscoveryAudit> {
  const base =
    SITE_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  const response = await fetch(`${base}/discovery/audit/latest.pretty.json`);
  if (!response.ok) {
    throw new Error("Audit not available");
  }
  return response.json();
}
