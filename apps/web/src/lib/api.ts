import type { DiffSummary, EvaluationResult, PillarScores } from "@agentability/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const SITE_BASE =
  import.meta.env.VITE_SITE_URL ??
  (API_BASE ? API_BASE.replace(/\/v1\/?$/, "") : "");
const A2ABENCH_BASE_URL = import.meta.env.VITE_A2ABENCH_BASE_URL ?? "https://a2abench-api.web.app";

export type EvaluateResponse = {
  runId: string;
  status: "complete" | "running" | "failed";
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
  spec_version?: string;
  live_checked_at?: string;
  strict_pretty?: boolean;
  live_sources?: string[];
  files?: Array<{ path?: string }>;
  discoverability_health?: {
    status: "pass" | "degraded" | "fail";
    missing?: string[];
    unreachable?: string[];
    optional_missing?: string[];
    optional_unreachable?: string[];
    hash_mismatch_required?: string[];
    hash_mismatch_optional?: string[];
  };
};

export type LeaderboardEntry = {
  domain: string;
  score: number;
  grade: string;
  reportUrl: string;
  badgeUrl?: string;
  verifiedAt?: string;
};

export type LeaderboardResponse = {
  updatedAt?: string;
  entries: LeaderboardEntry[];
};

export type CommunityFixCitation = {
  title?: string;
  url: string;
};

export type CommunityFixResponse = {
  status: "ok" | "unavailable";
  runId: string;
  issueId: string;
  query: string;
  mode?: "rag" | "retrieve_only";
  answerMd?: string;
  citations?: CommunityFixCitation[];
  cached?: boolean;
  searchUrl?: string;
  createdAt?: string;
  error?: string;
};

export type SubscribeResponse = {
  status: "ok";
  email: string;
  domain: string | null;
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

export async function subscribeEmail(email: string, domain?: string, runId?: string): Promise<SubscribeResponse> {
  const response = await fetch(`${API_BASE}/v1/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, domain, runId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error("Score updates are coming soon. Check back later.");
    }
    if (response.status === 429) {
      throw new Error("Too many requests. Please wait a minute and try again.");
    }
    throw new Error(error.message || error.error || "Subscription failed");
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
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : SITE_BASE;
  const response = await fetch(`${base}/discovery/audit/latest.pretty.json`);
  if (!response.ok) {
    throw new Error("Audit not available");
  }
  return response.json();
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  const base =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : SITE_BASE;
  const response = await fetch(`${base}/leaderboard.json`);
  if (!response.ok) {
    throw new Error("Leaderboard not available");
  }
  return response.json();
}

export function buildA2ABenchSearchUrl(query: string): string {
  const trimmed = A2ABENCH_BASE_URL.replace(/\/+$/, "");
  return `${trimmed}/search?q=${encodeURIComponent(query)}`;
}

export async function fetchCommunityFix(runId: string, issueId: string): Promise<CommunityFixResponse> {
  const response = await fetch(`${API_BASE}/v1/community-fix?runId=${encodeURIComponent(runId)}&issueId=${encodeURIComponent(issueId)}`);
  if (!response.ok) {
    throw new Error("Community fixes unavailable");
  }
  return response.json();
}
