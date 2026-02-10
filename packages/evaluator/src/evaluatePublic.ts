import { createHash } from "crypto";
import {
  CheckResult,
  EvaluationInput,
  EvaluationInputSchema,
  EvaluationProfile,
  EvaluationResult,
  EvidenceRecord,
} from "@agentability/shared";
import { FetchResult, safeFetch, SafeFetchOptions } from "./ssrf";

const ENGINE_VERSION = "0.1.0";
const SPEC_VERSION = "1.2";

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
    id: "C2",
    pillar: "callableSurface",
    severity: "high",
    summary: "Public OpenAPI surface is valid and example-rich",
  },
  {
    id: "C3",
    pillar: "callableSurface",
    severity: "high",
    summary: "MCP endpoint responds to discovery and initialize",
  },
  {
    id: "L1",
    pillar: "llmIngestion",
    severity: "high",
    summary: "Canonical docs entrypoint exists with meaningful text",
  },
  {
    id: "T1",
    pillar: "trust",
    severity: "high",
    summary: "air.json is complete and well-formed",
  },
  {
    id: "T2",
    pillar: "trust",
    severity: "high",
    summary: "AI plugin metadata includes legal and contact fields",
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

const DISCOVERY_ENDPOINTS = ["/.well-known/openapi.yaml", "/openapi.yaml", "/swagger.json"];

const DOCS_ENDPOINTS = ["/docs", "/documentation", "/developers"];

type DiscoveryState = {
  origin: string;
  domain: string;
  airRootUrl?: string;
  airWellKnownUrl?: string;
  airRoot?: FetchResult;
  airWellKnown?: FetchResult;
  airUrl?: string;
  openApiRootUrl?: string;
  openApiWellKnownUrl?: string;
  openApiRoot?: FetchResult;
  openApiWellKnown?: FetchResult;
  openApiUrl?: string;
  aiPluginUrl?: string;
  aiPlugin?: FetchResult;
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
  errors: Array<string | undefined>;
  stable: boolean;
  ok: boolean;
  contentTypeOk: boolean;
};

// Use a transparent, browser-compatible UA to reduce false positives from bot/WAF rules.
const USER_AGENT = "Mozilla/5.0 (compatible; Agentability/0.1; +https://agentability.org)";

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
  method: "GET" | "POST" = "GET",
  error?: string
): void {
  evidence.push({
    url: result.url,
    method,
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

function isSuccessStatus(result?: FetchResult): result is FetchResult {
  return Boolean(result && result.status >= 200 && result.status < 300);
}

function summarizeFetchError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Fetch failed";
  if (trimmed.includes("Response too large")) return "Response exceeded 2 MB limit";
  if (trimmed.includes("DNS resolution failed")) return "DNS resolution failed";
  if (trimmed.includes("Blocked hostname")) return "Blocked hostname";
  if (trimmed.includes("Blocked IP address")) return "Blocked IP address";
  if (trimmed.includes("Only http/https URLs are allowed")) return "Only http/https URLs are allowed";
  if (trimmed.includes("Too many redirects")) return "Too many redirects";
  return trimmed;
}

function isSuccessJson(result?: FetchResult): boolean {
  return isSuccessStatus(result) && isJsonLike(result.contentType);
}

function parseJsonBody(result?: FetchResult): Record<string, unknown> | null {
  if (!result?.bodyText) return null;
  try {
    const parsed = JSON.parse(result.bodyText) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getNestedString(
  record: Record<string, unknown> | null,
  path: string[]
): string | undefined {
  let current: unknown = record ?? undefined;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : undefined;
}

function uniqueUrls(values: Array<string | undefined>): string[] {
  const filtered = values.filter(Boolean) as string[];
  return Array.from(new Set(filtered));
}

async function fetchOnce(url: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const headers = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    ...(options.headers ?? {}),
  };
  return safeFetch(url, {
    ...options,
    headers,
  });
}

async function fetchRepeated(url: string, times: number): Promise<RepeatFetchResult> {
  const results: FetchResult[] = [];
  const errors: Array<string | undefined> = [];
  for (let i = 0; i < times; i += 1) {
    try {
      results.push(await fetchOnce(url));
      errors.push(undefined);
    } catch (error) {
      // Never abort the full evaluation because one fetch failed.
      // Record a synthetic result (status 0) so reports can reference it.
      results.push({
        url,
        status: 0,
        headers: {},
        fetchedAt: new Date().toISOString(),
        redirectChain: [],
      });
      errors.push(error instanceof Error ? error.message : String(error));
    }
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
  return { url, results, errors, stable, ok, contentTypeOk };
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

  const airRootUrl = `${origin}/air.json`;
  try {
    const airRootResult = await fetchOnce(airRootUrl);
    recordEvidence(state.evidence, airRootResult);
    state.airRoot = airRootResult;
    if (isSuccessJson(airRootResult)) {
      state.airRootUrl = airRootUrl;
      state.entrypoints.push(airRootUrl);
      if (!state.airUrl) {
        state.airUrl = airRootUrl;
      }
    }
  } catch (error) {
    state.notes.push(`air.json fetch failed: ${String(error)}`);
  }

  const airWellKnownUrl = `${origin}/.well-known/air.json`;
  try {
    const airWellKnownResult = await fetchOnce(airWellKnownUrl);
    recordEvidence(state.evidence, airWellKnownResult);
    state.airWellKnown = airWellKnownResult;
    if (isSuccessJson(airWellKnownResult)) {
      state.airWellKnownUrl = airWellKnownUrl;
      state.entrypoints.push(airWellKnownUrl);
      state.airUrl = airWellKnownUrl;
    }
  } catch (error) {
    state.notes.push(`air.json (well-known) fetch failed: ${String(error)}`);
  }

  const manifestSource = parseJsonBody(state.airRoot) ?? parseJsonBody(state.airWellKnown);
  if (manifestSource) {
    const docs =
      getNestedString(manifestSource, ["docs"]) ||
      getNestedString(manifestSource, ["documentation"]) ||
      getNestedString(manifestSource, ["llm_entrypoints", "docs_md"]);
    if (docs) {
      state.docsUrl = new URL(docs, origin).toString();
    }
  }

  const aiPluginUrl = `${origin}/.well-known/ai-plugin.json`;
  try {
    const aiPluginResult = await fetchOnce(aiPluginUrl);
    recordEvidence(state.evidence, aiPluginResult);
    state.aiPlugin = aiPluginResult;
    if (isSuccessJson(aiPluginResult)) {
      state.aiPluginUrl = aiPluginUrl;
    }
  } catch (error) {
    state.notes.push(`ai-plugin.json fetch failed: ${String(error)}`);
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

  const openApiRootUrl = `${origin}/openapi.json`;
  try {
    const openApiRootResult = await fetchOnce(openApiRootUrl);
    recordEvidence(state.evidence, openApiRootResult);
    state.openApiRoot = openApiRootResult;
    if (isSuccessJson(openApiRootResult)) {
      state.openApiRootUrl = openApiRootUrl;
      state.entrypoints.push(openApiRootUrl);
      if (!state.openApiUrl) {
        state.openApiUrl = openApiRootUrl;
      }
    }
  } catch (error) {
    state.notes.push(`openapi.json fetch failed: ${String(error)}`);
  }

  const openApiWellKnownUrl = `${origin}/.well-known/openapi.json`;
  try {
    const openApiWellKnownResult = await fetchOnce(openApiWellKnownUrl);
    recordEvidence(state.evidence, openApiWellKnownResult);
    state.openApiWellKnown = openApiWellKnownResult;
    if (isSuccessJson(openApiWellKnownResult)) {
      state.openApiWellKnownUrl = openApiWellKnownUrl;
      state.entrypoints.push(openApiWellKnownUrl);
      if (!state.openApiUrl) {
        state.openApiUrl = openApiWellKnownUrl;
      }
    }
  } catch (error) {
    state.notes.push(`openapi.json (well-known) fetch failed: ${String(error)}`);
  }

  for (const path of DISCOVERY_ENDPOINTS) {
    const candidate = `${origin}${path}`;
    if (candidate === openApiRootUrl || candidate === openApiWellKnownUrl) continue;
    if (state.openApiUrl) break;
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
    discovery.airRootUrl ||
    discovery.airWellKnownUrl ||
    discovery.serviceDescUrl ||
    discovery.openApiRootUrl ||
    discovery.openApiWellKnownUrl ||
    discovery.openApiUrl;
  const docsUrl = discovery.docsUrl;

  let entrypointRepeat: RepeatFetchResult | undefined;
  if (primaryEntrypoint) {
    entrypointRepeat = await fetchRepeated(primaryEntrypoint, 3);
    for (let i = 0; i < entrypointRepeat.results.length; i += 1) {
      recordEvidence(evidence, entrypointRepeat.results[i], "GET", entrypointRepeat.errors[i]);
    }
  }

  let docsRepeat: RepeatFetchResult | undefined;
  let docsText = "";
  if (docsUrl) {
    docsRepeat = await fetchRepeated(docsUrl, 3);
    for (let i = 0; i < docsRepeat.results.length; i += 1) {
      recordEvidence(evidence, docsRepeat.results[i], "GET", docsRepeat.errors[i]);
    }
    if (docsRepeat.ok) {
      docsText = extractMeaningfulText(docsRepeat.results[0]?.bodyText);
    }
  }

  const airRootOk = isSuccessJson(discovery.airRoot);
  const airWellKnownOk = isSuccessJson(discovery.airWellKnown);
  const airManifest = parseJsonBody(discovery.airRoot) ?? parseJsonBody(discovery.airWellKnown);
  const airMissingFields: string[] = [];
  if (!getNestedString(airManifest, ["canonical_base_url"])) {
    airMissingFields.push("canonical_base_url");
  }
  if (!getNestedString(airManifest, ["contact", "email"])) {
    airMissingFields.push("contact.email");
  }
  if (!getNestedString(airManifest, ["legal", "terms_url"])) {
    airMissingFields.push("legal.terms_url");
  }
  if (!getNestedString(airManifest, ["legal", "privacy_url"])) {
    airMissingFields.push("legal.privacy_url");
  }
  if (!getNestedString(airManifest, ["verification", "discovery_audit_json"])) {
    airMissingFields.push("verification.discovery_audit_json");
  }
  if (!getNestedString(airManifest, ["verification", "discovery_audit_html"])) {
    airMissingFields.push("verification.discovery_audit_html");
  }
  if (!getNestedString(airManifest, ["callable_surface", "openapi"])) {
    airMissingFields.push("callable_surface.openapi");
  }
  if (!getNestedString(airManifest, ["callable_surface", "mcp_endpoint"])) {
    airMissingFields.push("callable_surface.mcp_endpoint");
  }
  if (!getNestedString(airManifest, ["llm_entrypoints", "llms_txt"])) {
    airMissingFields.push("llm_entrypoints.llms_txt");
  }
  if (!getNestedString(airManifest, ["llm_entrypoints", "llms_full_txt"])) {
    airMissingFields.push("llm_entrypoints.llms_full_txt");
  }

  const aiPluginOk = isSuccessJson(discovery.aiPlugin);
  const aiPluginData = parseJsonBody(discovery.aiPlugin);
  const aiPluginContact = getNestedString(aiPluginData, ["contact_email"]);
  const aiPluginLegal = getNestedString(aiPluginData, ["legal_info_url"]);
  const aiPluginLegalOk = aiPluginLegal
    ? aiPluginLegal.toLowerCase().includes("/terms")
    : false;

  const openApiRootOk = isSuccessJson(discovery.openApiRoot);
  const openApiWellKnownOk = isSuccessJson(discovery.openApiWellKnown);
  const openApiData = parseJsonBody(discovery.openApiRoot);
  const openApiVersion =
    openApiData && typeof openApiData.openapi === "string" ? openApiData.openapi : "";
  const openApiVersionOk = openApiVersion.startsWith("3.");
  const requiredExamplePaths = [
    "/api/public/v1/status/summary",
    "/api/public/v1/incidents",
    "/api/public/v1/providers",
    "/api/public/v1/casual/status",
  ];
  const missingExamples: string[] = [];
  if (openApiData && typeof openApiData === "object") {
    const paths = (openApiData as Record<string, unknown>).paths as
      | Record<string, unknown>
      | undefined;
    for (const path of requiredExamplePaths) {
      const pathItem = paths ? (paths[path] as Record<string, unknown> | undefined) : undefined;
      const getOp = pathItem ? (pathItem.get as Record<string, unknown> | undefined) : undefined;
      const responses = getOp ? (getOp.responses as Record<string, unknown> | undefined) : undefined;
      const okResponse = responses ? (responses["200"] as Record<string, unknown> | undefined) : undefined;
      const content = okResponse ? (okResponse.content as Record<string, unknown> | undefined) : undefined;
      let hasExample = false;
      if (content) {
        for (const [contentType, value] of Object.entries(content)) {
          if (!contentType.includes("json") || !value || typeof value !== "object") {
            continue;
          }
          const exampleValue = (value as Record<string, unknown>).example;
          const examplesValue = (value as Record<string, unknown>).examples;
          if (exampleValue || (examplesValue && Object.keys(examplesValue).length > 0)) {
            hasExample = true;
            break;
          }
        }
      }
      if (!hasExample) {
        missingExamples.push(path);
      }
    }
  } else {
    missingExamples.push(...requiredExamplePaths);
  }

  const mcpUrl = `${origin}/mcp`;
  let mcpGetResult: FetchResult | undefined;
  let mcpInitResult: FetchResult | undefined;
  try {
    mcpGetResult = await fetchOnce(mcpUrl);
    recordEvidence(evidence, mcpGetResult);
  } catch (error) {
    discovery.notes.push(`mcp GET failed: ${String(error)}`);
  }
  try {
    const initPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    mcpInitResult = await fetchOnce(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: initPayload,
    });
    recordEvidence(evidence, mcpInitResult, "POST");
  } catch (error) {
    discovery.notes.push(`mcp initialize failed: ${String(error)}`);
  }
  const mcpGetOk =
    isSuccessStatus(mcpGetResult) && Boolean(mcpGetResult.bodyText?.trim());
  const mcpInitData = parseJsonBody(mcpInitResult);
  const mcpInitOk =
    isSuccessStatus(mcpInitResult) &&
    mcpInitData?.jsonrpc === "2.0" &&
    typeof (mcpInitData as Record<string, unknown>).result === "object" &&
    Boolean(
      getNestedString(mcpInitData as Record<string, unknown>, ["result", "protocolVersion"])
    );

  const checks: CheckResult[] = [];

  const hasEntrypoint = Boolean(primaryEntrypoint);
  checks.push({
    id: "D1",
    status: hasEntrypoint ? "pass" : "fail",
    severity: "high",
    summary: hasEntrypoint
      ? "Found at least one machine-readable entrypoint."
      : "No machine-readable entrypoints discovered.",
    evidence: discovery.entrypoints.length ? discovery.entrypoints : [],
  });

  const entrypointStable = entrypointRepeat?.stable ?? false;
  const entrypointOk = entrypointRepeat?.contentTypeOk ?? false;
  const entrypointStatusOk = entrypointRepeat?.ok ?? false;
  const entrypointError = entrypointRepeat?.errors.find(Boolean);
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
      ? entrypointError
        ? `Entrypoint fetch failed: ${summarizeFetchError(entrypointError)}.`
        : entrypointStatusOk
          ? entrypointStable
            ? "Entrypoint reachable with stable response."
            : "Entrypoint reachable but unstable across requests."
          : "Entrypoint responded with a non-success status."
      : "Entrypoint unreachable or missing.",
    evidence: primaryEntrypoint ? [primaryEntrypoint] : [],
  });

  const openApiStatus =
    openApiRootOk && openApiWellKnownOk && openApiVersionOk && missingExamples.length === 0
      ? "pass"
      : "fail";
  const openApiSummary = openApiRootOk
    ? openApiWellKnownOk
      ? openApiVersionOk
        ? missingExamples.length === 0
          ? "OpenAPI is valid and includes required examples."
          : `OpenAPI missing examples for: ${missingExamples.join(", ")}.`
        : "OpenAPI is present but not version 3.x."
      : "OpenAPI root found but /.well-known/openapi.json is missing."
    : "OpenAPI root endpoint missing or invalid.";
  const openApiEvidence = [`${origin}/openapi.json`, `${origin}/.well-known/openapi.json`];
  checks.push({
    id: "C2",
    status: openApiStatus,
    severity: "high",
    summary: openApiSummary,
    evidence: openApiEvidence,
  });

  const mcpStatus = mcpGetOk && mcpInitOk ? "pass" : "fail";
  const mcpSummary = mcpGetOk
    ? mcpInitOk
      ? "MCP endpoint responds to GET and initialize."
      : "MCP initialize did not return a valid JSON-RPC response."
    : "MCP endpoint did not return explainer text.";
  checks.push({
    id: "C3",
    status: mcpStatus,
    severity: "high",
    summary: mcpSummary,
    evidence: [mcpUrl],
  });

  let l1Status: CheckResult["status"] = "fail";
  const docsError = docsRepeat?.errors.find(Boolean);
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
      ? docsError
        ? `Docs fetch failed: ${summarizeFetchError(docsError)}.`
        : l1Status === "pass"
          ? "Docs entrypoint contains meaningful text."
          : "Docs entrypoint found but content appears thin."
      : "No docs entrypoint discovered.",
    evidence: docsUrl ? [docsUrl] : [],
  });

  const airStatus = airRootOk && airWellKnownOk && airMissingFields.length === 0 ? "pass" : "fail";
  const airSummary = airRootOk && airWellKnownOk
    ? airMissingFields.length
      ? `air.json missing required fields: ${airMissingFields.join(", ")}.`
      : "air.json is present with required fields."
    : "air.json endpoints missing or invalid.";
  const airEvidence = [`${origin}/air.json`, `${origin}/.well-known/air.json`];
  checks.push({
    id: "T1",
    status: airStatus,
    severity: "high",
    summary: airSummary,
    evidence: airEvidence,
  });

  const aiPluginStatus = aiPluginOk && aiPluginContact && aiPluginLegalOk ? "pass" : "fail";
  const aiPluginSummary = aiPluginOk
    ? aiPluginContact && aiPluginLegalOk
      ? "AI plugin metadata includes legal and contact fields."
      : "AI plugin metadata missing legal or contact fields."
    : "AI plugin manifest missing or invalid.";
  checks.push({
    id: "T2",
    status: aiPluginStatus,
    severity: "high",
    summary: aiPluginSummary,
    evidence: [`${origin}/.well-known/ai-plugin.json`],
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
  const entrypoints = uniqueUrls([
    `${origin}/air.json`,
    `${origin}/.well-known/air.json`,
    `${origin}/openapi.json`,
    `${origin}/.well-known/openapi.json`,
    discovery.serviceDescUrl,
  ]);
  const callable = uniqueUrls([
    `${origin}/openapi.json`,
    `${origin}/.well-known/openapi.json`,
    mcpUrl,
    `${origin}/.well-known/ai-plugin.json`,
  ]);

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
      entrypoints,
      callable,
      docs: docsUrl ? [docsUrl] : [],
      attestations: [],
    },
    artifacts: {},
    engine: {
      version: ENGINE_VERSION,
      rulesetHash: buildRulesetHash(),
      specVersion: SPEC_VERSION,
    },
    createdAt,
    completedAt: new Date().toISOString(),
  };

  return { result, evidence };
}
