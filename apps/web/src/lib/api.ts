import type { EvaluationResult } from "@agentability/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type EvaluateResponse = {
  runId: string;
  status: "complete" | "running";
  reportUrl: string;
  jsonUrl: string;
  statusUrl: string;
  domain: string;
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
    throw new Error(error.error || "Evaluation failed");
  }
  return response.json();
}

export async function fetchRun(runId: string): Promise<EvaluationResult> {
  const response = await fetch(`${API_BASE}/v1/runs/${runId}`);
  if (!response.ok) {
    throw new Error("Run not found");
  }
  return response.json();
}

export async function fetchLatest(domain: string): Promise<EvaluationResult> {
  const response = await fetch(`${API_BASE}/v1/evaluations/${domain}/latest.json`);
  if (!response.ok) {
    throw new Error("Evaluation not found");
  }
  return response.json();
}
