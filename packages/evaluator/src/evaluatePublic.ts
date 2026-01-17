import { createHash } from "crypto";
import {
  CheckResult,
  EvaluationInput,
  EvaluationInputSchema,
  EvaluationProfile,
  EvaluationResult,
  EvidenceRecord,
} from "@agentability/shared";
import { FetchResult, safeFetch } from "./ssrf";

const ENGINE_VERSION = "0.1.0";

type Pillar = "discovery" | "callableSurface" | "llmIngestion" | "trust" | "reliability";

type CheckDefinition = {
  id: string;
  pillar: Pillar;
  severity: "high" | "medium" | "low";
  summary: string;
};

const CHECKS: CheckDefinition[] = [
  {
    id: "D1",
    pillar: "discovery",
    severity: "high",
    summary: "Machine-readable entrypoints exist",
  },
  {
    id: "D2",
    pillar: "discovery",
    severity: "high",
    summary: "Entrypoints are reachable, correct, and stable",
  },
  {
    id: "L1",
    pillar: "llmIngestion",
    severity: "high",
    summary: "Canonical docs entrypoint exists with meaningful text",
  },
  {
    id: "R3",
    pillar: "reliability",
    severity: "high",
    summary: "Repeat-request consistency for critical surfaces",
  },
];

const PROFILE_WEIGHTS: Record<EvaluationProfile, Record<Pillar, number>> = {
  auto: {
    discovery: 0.3,
    callableSurface: 0.2,
    llmIngestion: 0.2,
    trust: 0.1,
    reliability: 0.2,
  },
  api_product: {
    discovery: 0.35,
    callableSurface: 0.3,
    llmIngestion: 0.15,
    trust: 0.1,
    reliability: 0.1,
  },
  docs_platform: {
    discovery: 0.25,
    callableSurface: 0.15,
    llmIngestion: 0.35,
    trust: 0.1,
    reliability: 0.15,
  },
  content: {
    discovery: 0.3,
    callableSurface: 0.05,
    llmIngestion: 0.35,
    trust: 0.1,
    reliability: 0.2,
  },
  hybrid: {
    discovery: 0.3,
    callableSurface: 0.2,
    llmIngestion: 0.25,
    trust: 0.1,
    reliability: 0.15,
  },
};

const DISCOVERY_ENDPOINTS = [
  "/.well-known/openapi.json",
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
];

const DOCS_ENDPOINTS = ["/docs", "/documentation", "/developers"];

type DiscoveryState = {
  origin: string;
  domain: string;
  airUrl?: string;
  openApiUrl?: string;
  serviceDescUrl?: string;
  llmsUrl?: string;
  robotsUrl?: string;
  docsUrl?: string;
  entrypoints: string[];
  evidence: EvidenceRecord[];
  notes: string[];
};

type RepeatFetchResult = {
  url: string;
  results: FetchResult[];
  stable: boolean;
  ok: boolean;
  contentTypeOk: boolean;
};

const USER_AGENT = "AgentabilityEvaluator/0.1 (+https://agentability.org)";

function coerceOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function normalizeOrigin(raw: string): { origin: string; domain: string } {
  const url = new URL(coerceOrigin(raw));
  const origin = `${url.protocol}//${url.host}`;
  const domain = url.hostname.toLowerCase();
  return { origin, domain };
}

function recordEvidence(
  evidence: EvidenceRecord[],
  result: FetchResult,
  error?: string
): void {
  evidence.push({
    url: result.url,
    method: "GET",
    status: result.status,
    headers: result.headers,
    contentType: result.contentType,
    contentLength: result.contentLength,
    sha256: result.sha256,
    fetchedAt: result.fetchedAt,
    redirectChain: result.redirectChain.length ? result.redirectChain : undefined,
    error,
  });
}

function isJsonLike(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.includes("json") || contentType.includes("+json");
}

function isYamlLike(contentType?: string): boolean {
  if (!contentType) return false;
  return contentType.includes("yaml") || contentType.includes("yml");
}

function extractServiceDescFromLink(headerValue?: string | null): string | undefined {
  if (!headerValue) return undefined;
  const parts = headerValue.split(",");
  for (const part of parts) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/rel\s*=\s*"?([^";]+)"?/i);
    if (urlMatch && relMatch && relMatch[1] === "service-desc") {
      return urlMatch[1];
    }
  }
  return undefined;
}

function extractServiceDescFromHtml(html?: string): string | undefined {
  if (!html) return undefined;
  const linkMatch = html.match(/<link[^>]*rel=["']service-desc["'][^>]*>/i);
  if (!linkMatch) return undefined;
  const hrefMatch = linkMatch[0].match(/href=["']([^"']+)["']/i);
  return hrefMatch ? hrefMatch[1] : undefined;
}

function extractMeaningfulText(html?: string): string {
  if (!html) return "";
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

async function fetchOnce(url: string): Promise<FetchResult> {
  return safeFetch(url, {
    headers: { "user-agent": USER_AGENT },
  });
}

async function fetchRepeated(url: string, times: number): Promise<RepeatFetchResult> {
  const results: FetchResult[] = [];
  for (let i = 0; i < times; i += 1) {
    results.push(await fetchOnce(url));
  }
  const status = results[0]?.status;
  const type = results[0]?.contentType;
  const sha = results[0]?.sha256;
  const ok = results.every((result) => result.status >= 200 && result.status < 300);
  const stable = results.every(
    (result) => result.status === status && result.sha256 === sha
  );
  const contentTypeOk =
    ok && (isJsonLike(type) || isYamlLike(type) || Boolean(type && type.includes("text/")));
  return { url, results, stable, ok, contentTypeOk };
}

async function discover(origin: string): Promise<DiscoveryState> {
  const { domain } = normalizeOrigin(origin);
  const state: DiscoveryState = {
    origin,
    domain,
    entrypoints: [],
    evidence: [],
    notes: [],
  };

  const airUrl = `${origin}/.well-known/air.json`;
  try {
    const airResult = await fetchOnce(airUrl);
    recordEvidence(state.evidence, airResult);
    if (airResult.status >= 200 && airResult.status < 300 && isJsonLike(airResult.contentType)) {
      state.airUrl = airUrl;
      state.entrypoints.push(airUrl);
      if (airResult.bodyText) {
        try {
          const manifest = JSON.parse(airResult.bodyText) as Record<string, unknown>;
          const docs =
            (typeof manifest.docs === "string" && manifest.docs) ||
            (typeof manifest.documentation === "string" && manifest.documentation);
          if (docs) {
            state.docsUrl = new URL(docs, origin).toString();
          }
        } catch {
          state.notes.push("Failed to parse air.json");
        }
      }
    }
  } catch (error) {
    state.notes.push(`air.json fetch failed: ${String(error)}`);
  }

  try {
    const rootResult = await fetchOnce(`${origin}/`);
    recordEvidence(state.evidence, rootResult);
    const headerLink = extractServiceDescFromLink(rootResult.headers?.link);
    const htmlLink = extractServiceDescFromHtml(rootResult.bodyText);
    const serviceDesc = headerLink || htmlLink;
    if (serviceDesc) {
      const resolved = new URL(serviceDesc, origin).toString();
      state.serviceDescUrl = resolved;
      state.entrypoints.push(resolved);
    }
  } catch (error) {
    state.notes.push(`Root fetch failed: ${String(error)}`);
  }

  for (const path of DISCOVERY_ENDPOINTS) {
    if (state.openApiUrl) break;
    const candidate = `${origin}${path}`;
    try {
      const apiResult = await fetchOnce(candidate);
      recordEvidence(state.evidence, apiResult);
      if (
        apiResult.status >= 200 &&
        apiResult.status < 300 &&
        (isJsonLike(apiResult.contentType) || isYamlLike(apiResult.contentType))
      ) {
        state.openApiUrl = candidate;
        state.entrypoints.push(candidate);
      }
    } catch (error) {
      state.notes.push(`OpenAPI probe failed: ${String(error)}`);
    }
  }

  const llmsUrl = `${origin}/llms.txt`;
  try {
    const llmsResult = await fetchOnce(llmsUrl);
    recordEvidence(state.evidence, llmsResult);
    if (llmsResult.status >= 200 && llmsResult.status < 300) {
      state.llmsUrl = llmsUrl;
    }
  } catch (error) {
    state.notes.push(`llms.txt fetch failed: ${String(error)}`);
  }

  const robotsUrl = `${origin}/robots.txt`;
  try {
    const robotsResult = await fetchOnce(robotsUrl);
    recordEvidence(state.evidence, robotsResult);
    if (robotsResult.status >= 200 && robotsResult.status < 300) {
      state.robotsUrl = robotsUrl;
    }
  } catch (error) {
    state.notes.push(`robots.txt fetch failed: ${String(error)}`);
  }

  if (!state.docsUrl) {
    for (const path of DOCS_ENDPOINTS) {
      const candidate = `${origin}${path}`;
      try {
        const docsResult = await fetchOnce(candidate);
        recordEvidence(state.evidence, docsResult);
        if (docsResult.status >= 200 && docsResult.status < 300) {
          state.docsUrl = candidate;
          break;
        }
      } catch (error) {
        state.notes.push(`Docs probe failed: ${String(error)}`);
      }
    }
  }

  return state;
}

function buildRulesetHash(): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ checks: CHECKS, weights: PROFILE_WEIGHTS }))
    .digest("hex");
  return hash.slice(0, 12);
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "Not AI-Native";
}

function scoreStatus(status: CheckResult["status"]): number {
  if (status === "pass") return 1;
  if (status === "warn") return 0.5;
  return 0;
}

function aggregateScores(checks: CheckResult[], profile: EvaluationProfile) {
  const pillarTotals: Record<Pillar, { points: number; max: number }> = {
    discovery: { points: 0, max: 0 },
    callableSurface: { points: 0, max: 0 },
    llmIngestion: { points: 0, max: 0 },
    trust: { points: 0, max: 0 },
    reliability: { points: 0, max: 0 },
  };

  for (const check of CHECKS) {
    const result = checks.find((item) => item.id === check.id);
    if (!result) continue;
    pillarTotals[check.pillar].points += scoreStatus(result.status);
    pillarTotals[check.pillar].max += 1;
  }

  const pillarScores: Record<Pillar, number> = {
    discovery: 0,
    callableSurface: 0,
    llmIngestion: 0,
    trust: 0,
    reliability: 0,
  };

  for (const pillar of Object.keys(pillarTotals) as Pillar[]) {
    const { points, max } = pillarTotals[pillar];
    pillarScores[pillar] = max ? Math.round((points / max) * 100) : 0;
  }

  const weights = PROFILE_WEIGHTS[profile];
  let totalScore = 0;
  for (const pillar of Object.keys(weights) as Pillar[]) {
    totalScore += pillarScores[pillar] * weights[pillar];
  }

  const roundedScore = Math.round(totalScore);
  return { pillarScores, score: roundedScore, grade: gradeFromScore(roundedScore) };
}

export async function evaluatePublic(
  rawInput: EvaluationInput
): Promise<{ result: EvaluationResult; evidence: EvidenceRecord[] }> {
  const coerced = { ...rawInput, origin: coerceOrigin(rawInput.origin) };
  const input = EvaluationInputSchema.parse(coerced);
  const { origin, domain } = normalizeOrigin(input.origin);
  const createdAt = new Date().toISOString();

  const discovery = await discover(origin);
  const evidence = discovery.evidence;

  const primaryEntrypoint =
    discovery.airUrl || discovery.serviceDescUrl || discovery.openApiUrl;
  const docsUrl = discovery.docsUrl;

  let entrypointRepeat: RepeatFetchResult | undefined;
  if (primaryEntrypoint) {
    entrypointRepeat = await fetchRepeated(primaryEntrypoint, 3);
    for (const result of entrypointRepeat.results) {
      recordEvidence(evidence, result);
    }
  }

  let docsRepeat: RepeatFetchResult | undefined;
  let docsText = "";
  if (docsUrl) {
    docsRepeat = await fetchRepeated(docsUrl, 3);
    for (const result of docsRepeat.results) {
      recordEvidence(evidence, result);
    }
    if (docsRepeat.ok) {
      docsText = extractMeaningfulText(docsRepeat.results[0]?.bodyText);
    }
  }

  const checks: CheckResult[] = [];

  const hasEntrypoint = Boolean(primaryEntrypoint);
  checks.push({
    id: "D1",
    status: hasEntrypoint ? "pass" : "fail",
    severity: "high",
    summary: hasEntrypoint
      ? "Found at least one machine-readable entrypoint."
      : "No machine-readable entrypoints discovered.",
    evidence: primaryEntrypoint ? [primaryEntrypoint] : [],
  });

  const entrypointStable = entrypointRepeat?.stable ?? false;
  const entrypointOk = entrypointRepeat?.contentTypeOk ?? false;
  const entrypointStatusOk = entrypointRepeat?.ok ?? false;
  const d2Status = entrypointRepeat
    ? entrypointStatusOk
      ? entrypointStable && entrypointOk
        ? "pass"
        : "warn"
      : "fail"
    : "fail";

  checks.push({
    id: "D2",
    status: d2Status,
    severity: "high",
    summary: entrypointRepeat
      ? entrypointStatusOk
        ? entrypointStable
          ? "Entrypoint reachable with stable response."
          : "Entrypoint reachable but unstable across requests."
        : "Entrypoint responded with a non-success status."
      : "Entrypoint unreachable or missing.",
    evidence: primaryEntrypoint ? [primaryEntrypoint] : [],
  });

  let l1Status: CheckResult["status"] = "fail";
  if (docsRepeat) {
    if (!docsRepeat.ok) {
      l1Status = "fail";
    } else {
      const meaningful = docsText.length >= 200;
      l1Status = meaningful ? "pass" : "warn";
    }
  }

  checks.push({
    id: "L1",
    status: l1Status,
    severity: "high",
    summary: docsRepeat
      ? l1Status === "pass"
        ? "Docs entrypoint contains meaningful text."
        : "Docs entrypoint found but content appears thin."
      : "No docs entrypoint discovered.",
    evidence: docsUrl ? [docsUrl] : [],
  });

  const entrypointConsistent = entrypointRepeat
    ? entrypointRepeat.ok && entrypointRepeat.stable
    : true;
  const docsConsistent = docsRepeat ? docsRepeat.ok && docsRepeat.stable : true;
  const r3Stable =
    entrypointConsistent && docsConsistent && Boolean(primaryEntrypoint || docsUrl);

  checks.push({
    id: "R3",
    status: r3Stable ? "pass" : "fail",
    severity: "high",
    summary: r3Stable
      ? "Critical surfaces are consistent across repeated requests."
      : "Critical surfaces show variance across repeated requests.",
    evidence: [primaryEntrypoint, docsUrl].filter(Boolean) as string[],
  });

  const profile = input.profile ?? "auto";
  const scores = aggregateScores(checks, profile);

  const result: EvaluationResult = {
    runId: "",
    domain,
    mode: "public",
    profile,
    input: { origin },
    status: "complete",
    score: scores.score,
    grade: scores.grade,
    pillarScores: {
      discovery: scores.pillarScores.discovery,
      callableSurface: scores.pillarScores.callableSurface,
      llmIngestion: scores.pillarScores.llmIngestion,
      trust: scores.pillarScores.trust,
      reliability: scores.pillarScores.reliability,
    },
    checks,
    evidenceIndex: {
      entrypoints: discovery.entrypoints,
      docs: docsUrl ? [docsUrl] : [],
      attestations: [],
    },
    artifacts: {},
    engine: {
      version: ENGINE_VERSION,
      rulesetHash: buildRulesetHash(),
    },
    createdAt,
    completedAt: new Date().toISOString(),
  };

  return { result, evidence };
}
