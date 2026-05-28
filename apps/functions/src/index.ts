import crypto from "crypto";
import dns from "node:dns/promises";
import net from "node:net";
import cors from "cors";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { evaluatePublic } from "@agentability/evaluator";
import {
  EvaluationInputSchema,
  EvaluationProfile,
  EvaluationResult,
  computeDiff,
  buildCommunityFixQuery,
  buildA2ABenchQuestionsUrl,
  getFixIt,
} from "@agentability/shared";
import { SSR_ASSETS } from "./ssr/asset-manifest";
import { renderBadgeSvg } from "./brand/renderBadgeSvg";

initializeApp();

const db = getFirestore();
// Many fields in our run/evaluation documents are optional. By default Firestore rejects
// `undefined` values, which causes first-time evaluations (no previousRunId/diffSummary)
// to fail hard. Treat `undefined` as "omit this field" instead.
db.settings({ ignoreUndefinedProperties: true });
const storage = getStorage();
const evidenceBucketName =
  process.env.EVIDENCE_BUCKET ||
  (process.env.GCLOUD_PROJECT ? `${process.env.GCLOUD_PROJECT}-evidence` : undefined);
const A2ABENCH_BASE_URL = process.env.A2ABENCH_BASE_URL || "https://a2abench-api.web.app";
const CANONICAL_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://agentability.org").replace(/\/+$/, "");

const app = express();
// We sit behind a CDN / reverse proxy in production. `req.ip` is unreliable unless
// we explicitly trust (some) proxy hops. We still defensively validate IP strings
// because client-controlled headers are spoofable.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const AGENTABILITY_VERSION = process.env.AGENTABILITY_VERSION || "0.1.0";
const AGENTABILITY_REVISION = process.env.AGENTABILITY_BUILD || process.env.K_REVISION || "";

const allowedPostOrigins = new Set([
  "https://agentability.org",
  "https://www.agentability.org",
  "https://agentability-prod-jenfjn.web.app",
  "https://agentability-prod-jenfjn.firebaseapp.com",
]);

function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch (error) {
    return false;
  }
}

const corsHandler = cors((req, callback) => {
  const origin = req.headers.origin;
  if (req.method === "GET") {
    return callback(null, { origin: true });
  }
  if (origin && (allowedPostOrigins.has(origin) || isLocalhostOrigin(origin))) {
    return callback(null, { origin: true });
  }
  return callback(null, { origin: false });
});

app.use(corsHandler);
app.options("*", corsHandler);

// Make it easy to confirm which backend revision is serving requests.
app.use((_req, res, next) => {
  res.set("x-agentability-version", AGENTABILITY_VERSION);
  if (AGENTABILITY_REVISION) {
    res.set("x-agentability-revision", AGENTABILITY_REVISION);
  }
  next();
});

function getRequestIp(req: express.Request): string {
  const candidates = [
    req.header("fastly-client-ip"),
    req.header("cf-connecting-ip"),
    req.header("true-client-ip"),
    req.header("x-appengine-user-ip"),
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (net.isIP(candidate)) return candidate;
  }

  const forwarded = req.header("x-forwarded-for");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const trimmed = part.trim();
      if (trimmed && net.isIP(trimmed)) return trimmed;
    }
  }

  const ip = typeof req.ip === "string" ? req.ip.trim() : "";
  if (ip && net.isIP(ip)) return ip;
  return "unknown";
}

type RateLimitDetails = {
  retryAfterSeconds: number;
  limit: number;
  windowSeconds: number;
  windowResetAt: string;
};

class RateLimitError extends Error {
  readonly details: RateLimitDetails;
  constructor(details: RateLimitDetails) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
    this.details = details;
  }
}

function toRateLimitDetails(windowMs: number, maxRequests: number, windowId: number): RateLimitDetails {
  const windowEndMs = (windowId + 1) * windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));
  return {
    retryAfterSeconds,
    limit: maxRequests,
    windowSeconds: Math.floor(windowMs / 1000),
    windowResetAt: new Date(windowEndMs).toISOString(),
  };
}

async function enforceRateLimitForCollection(
  collection: string,
  ip: string,
  windowMs: number,
  maxRequests: number
): Promise<void> {
  const windowId = Math.floor(Date.now() / windowMs);
  const docId = `${ip.replace(/[:.]/g, "_")}_${windowId}`;
  const ref = db.collection(collection).doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()?.count as number) || 0 : 0;
    if (count >= maxRequests) {
      throw new RateLimitError(toRateLimitDetails(windowMs, maxRequests, windowId));
    }
    tx.set(
      ref,
      {
        ip,
        count: count + 1,
        windowId,
        updatedAt: FieldValue.serverTimestamp(),
        // Used for Firestore TTL policies (expects a Timestamp).
        expiresAt: Timestamp.fromMillis(Date.now() + windowMs * 2),
      },
      { merge: true }
    );
  });
}

async function enforceRateLimit(ip: string): Promise<void> {
  const windowMs = 5 * 60 * 1000;
  // 10/5min is too low for a typical "try a handful of domains" workflow.
  // Keep it modest to protect the service, but high enough that normal usage
  // doesn't immediately trip the limiter.
  const maxRequests = 30;
  await enforceRateLimitForCollection("rateLimits", ip, windowMs, maxRequests);
}

async function enforceCommunityFixRateLimit(ip: string): Promise<void> {
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 30;
  await enforceRateLimitForCollection("rateLimitsCommunityFix", ip, windowMs, maxRequests);
}

async function enforceSubscribeRateLimit(ip: string): Promise<void> {
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 20;
  await enforceRateLimitForCollection("rateLimitsSubscribe", ip, windowMs, maxRequests);
}

function buildBaseUrl(req: express.Request): string {
  if (CANONICAL_BASE_URL) {
    return CANONICAL_BASE_URL;
  }
  const proto = req.header("x-forwarded-proto") || req.protocol;
  const host = req.header("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

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

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "local"]);

function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local");
}

async function ensureResolvableDomain(origin: string): Promise<{ origin: string; domain: string }> {
  const { origin: normalizedOrigin, domain } = normalizeOrigin(origin);

  if (isBlockedHostname(domain) || net.isIP(domain)) {
    throw new Error("Blocked hostname");
  }

  try {
    const records = await dns.lookup(domain, { all: true });
    if (!records.length) {
      throw new Error("DNS resolution failed");
    }
  } catch (error) {
    throw new Error("DNS resolution failed");
  }

  return { origin: normalizedOrigin, domain };
}

function sendError(
  res: express.Response,
  status: number,
  message: string,
  code: string,
  details?: unknown
) {
  return res.status(status).json({ message, code, details });
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  if (email.length > 254) return false;
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

type CommunityFixResult = {
  title: string;
  url: string;
  score?: number;
  excerpt?: string;
};
type CommunityFixPayload = {
  status: "available" | "no_matches" | "unavailable";
  runId: string;
  issueId: string;
  query: string;
  cached: boolean;
  sourceUrl: string;
  results: CommunityFixResult[];
  createdAt: string;
  error?: string;
};

const COMMUNITY_FIX_CACHE_TTL_MS = 5 * 60 * 1000;
const COMMUNITY_FIX_BREAKER_TIMEOUT_MS = 60 * 1000;
const COMMUNITY_FIX_UPSTREAM_TIMEOUT_MS = 1500;

const communityFixCache = new Map<string, { expiresAtMs: number; payload: CommunityFixPayload }>();
const communityFixBreakerState = {
  consecutiveFailures: 0,
  openUntilMs: 0,
};

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function tokenizeCommunityFixQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 12);
}

function normalizeCommunityFixResults(query: string, payload: unknown): CommunityFixResult[] {
  const rows = Array.isArray((payload as Record<string, unknown>)?.results)
    ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) return [];
  const queryTokens = tokenizeCommunityFixQuery(query);
  const scored = rows.map((row) => {
    const prompt = typeof row.prompt === "string" ? row.prompt : "";
    const source = typeof row.source === "string" ? row.source : "";
    const text = `${prompt} ${source}`.toLowerCase();
    const matches = queryTokens.filter((token) => text.includes(token)).length;
    return {
      title: prompt || "A2ABench question",
      url: source || `${A2ABENCH_BASE_URL.replace(/\/+$/, "")}/v1/eval/questions`,
      excerpt: prompt.slice(0, 280),
      score: matches,
      _matches: matches,
    };
  });
  return scored
    .filter((row) => row._matches > 0)
    .sort((a, b) => b._matches - a._matches)
    .slice(0, 10)
    .map(({ _matches, ...rest }) => rest);
}

function buildCommunityFixUnavailablePayload(args: {
  runId: string;
  issueId: string;
  query: string;
  sourceUrl: string;
  error: string;
}): CommunityFixPayload {
  return {
    status: "unavailable",
    runId: args.runId,
    issueId: args.issueId,
    query: args.query,
    cached: false,
    sourceUrl: args.sourceUrl,
    results: [],
    createdAt: new Date().toISOString(),
    error: args.error,
  };
}

async function resolveCommunityFix(query: string, runId: string, issueId: string): Promise<CommunityFixPayload> {
  const cacheKey = query.trim().toLowerCase();
  const now = Date.now();
  const sourceUrl = buildA2ABenchQuestionsUrl(A2ABENCH_BASE_URL);
  const cached = communityFixCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return { ...cached.payload, runId, issueId, cached: true };
  }

  if (communityFixBreakerState.openUntilMs > now) {
    return buildCommunityFixUnavailablePayload({
      runId,
      issueId,
      query,
      sourceUrl,
      error: "A2ABench temporarily unavailable (circuit breaker open)",
    });
  }

  try {
    const response = await fetchJsonWithTimeout(sourceUrl, COMMUNITY_FIX_UPSTREAM_TIMEOUT_MS);
    if (response.status >= 500) {
      throw new Error(`A2ABench upstream error (${response.status})`);
    }
    if (!response.ok) {
      const payload: CommunityFixPayload = {
        status: "no_matches",
        runId,
        issueId,
        query,
        cached: false,
        sourceUrl,
        results: [],
        createdAt: new Date().toISOString(),
      };
      communityFixCache.set(cacheKey, {
        expiresAtMs: now + COMMUNITY_FIX_CACHE_TTL_MS,
        payload,
      });
      return payload;
    }

    const body = await response.json();
    const results = normalizeCommunityFixResults(query, body);
    const payload: CommunityFixPayload = {
      status: results.length ? "available" : "no_matches",
      runId,
      issueId,
      query,
      cached: false,
      sourceUrl,
      results,
      createdAt: new Date().toISOString(),
    };
    communityFixCache.set(cacheKey, {
      expiresAtMs: now + COMMUNITY_FIX_CACHE_TTL_MS,
      payload,
    });
    communityFixBreakerState.consecutiveFailures = 0;
    communityFixBreakerState.openUntilMs = 0;
    return payload;
  } catch (error) {
    communityFixBreakerState.consecutiveFailures += 1;
    if (communityFixBreakerState.consecutiveFailures >= 3) {
      communityFixBreakerState.openUntilMs = now + COMMUNITY_FIX_BREAKER_TIMEOUT_MS;
      communityFixBreakerState.consecutiveFailures = 0;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "A2ABench timeout"
        : error instanceof Error
          ? error.message
          : "A2ABench unavailable";
    return buildCommunityFixUnavailablePayload({
      runId,
      issueId,
      query,
      sourceUrl,
      error: message,
    });
  }
}

type PillarKey = "discovery" | "callableSurface" | "llmIngestion" | "trust" | "reliability";

const SITE_NAME = "Agentability";
const DEFAULT_DESCRIPTION =
  "Agentability audits public machine entrypoints, docs, and reliability to score agent readiness.";
const ROBOTS_INDEX =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const SIBLING_A2ABENCH_URL = "https://a2abench-api.web.app";
const SIBLING_RAGMAP_URL = "https://ragmap-api.web.app";
const SIBLING_ROOTFETCH_URL = "https://rootfetch.com";
const SIBLING_RELAYORB_URL = "https://relayorb.com";
const SIBLING_AISTATUSDASHBOARD_URL = "https://aistatusdashboard.com";

type SiblingStatsLink = {
  name: string;
  url: string;
  stats_url: string;
  stats_json_url: string;
  agent_card_url: string;
};

function siblingLinksForStats(): Record<string, SiblingStatsLink> {
  return {
    a2abench: {
      name: "A2ABench",
      url: SIBLING_A2ABENCH_URL,
      stats_url: `${SIBLING_A2ABENCH_URL}/stats`,
      stats_json_url: `${SIBLING_A2ABENCH_URL}/stats.json`,
      agent_card_url: `${SIBLING_A2ABENCH_URL}/.well-known/agent.json`,
    },
    ragmap: {
      name: "Ragmap",
      url: SIBLING_RAGMAP_URL,
      stats_url: `${SIBLING_RAGMAP_URL}/stats`,
      stats_json_url: `${SIBLING_RAGMAP_URL}/stats.json`,
      agent_card_url: `${SIBLING_RAGMAP_URL}/.well-known/agent.json`,
    },
    rootfetch: {
      name: "Rootfetch",
      url: SIBLING_ROOTFETCH_URL,
      stats_url: `${SIBLING_ROOTFETCH_URL}/stats`,
      stats_json_url: `${SIBLING_ROOTFETCH_URL}/stats.json`,
      agent_card_url: `${SIBLING_ROOTFETCH_URL}/.well-known/agent.json`,
    },
    relayorb: {
      name: "RelayOrb",
      url: SIBLING_RELAYORB_URL,
      stats_url: `${SIBLING_RELAYORB_URL}/stats`,
      stats_json_url: `${SIBLING_RELAYORB_URL}/stats.json`,
      agent_card_url: `${SIBLING_RELAYORB_URL}/.well-known/agent.json`,
    },
    aistatusdashboard: {
      name: "AIStatusDashboard",
      url: SIBLING_AISTATUSDASHBOARD_URL,
      stats_url: `${SIBLING_AISTATUSDASHBOARD_URL}/stats`,
      stats_json_url: `${SIBLING_AISTATUSDASHBOARD_URL}/stats.json`,
      agent_card_url: `${SIBLING_AISTATUSDASHBOARD_URL}/.well-known/agent.json`,
    },
  };
}

function relatedProjectsForAgentCard() {
  return [
    {
      name: "A2ABench",
      url: SIBLING_A2ABENCH_URL,
      agent_card_url: `${SIBLING_A2ABENCH_URL}/.well-known/agent.json`,
      description: "Public benchmark for agent Q&A performance.",
    },
    {
      name: "Ragmap",
      url: SIBLING_RAGMAP_URL,
      agent_card_url: `${SIBLING_RAGMAP_URL}/.well-known/agent.json`,
      description: "MCP search and RAG-focused server discovery.",
    },
    {
      name: "Rootfetch",
      url: SIBLING_ROOTFETCH_URL,
      agent_card_url: `${SIBLING_ROOTFETCH_URL}/.well-known/agent.json`,
      description: "DNS delegation intelligence with MCP telemetry.",
    },
    {
      name: "RelayOrb",
      url: SIBLING_RELAYORB_URL,
      agent_card_url: `${SIBLING_RELAYORB_URL}/.well-known/agent.json`,
      description: "Tool control plane for AI agents with contract-first routing.",
    },
    {
      name: "AIStatusDashboard",
      url: SIBLING_AISTATUSDASHBOARD_URL,
      agent_card_url: `${SIBLING_AISTATUSDASHBOARD_URL}/.well-known/agent.json`,
      description: "Real-time AI provider status monitoring with evidence-backed metrics.",
    },
  ];
}

const PILLAR_LABELS: Record<PillarKey, string> = {
  discovery: "Discovery",
  callableSurface: "Callable Surface",
  llmIngestion: "LLM Ingestion",
  trust: "Trust",
  reliability: "Reliability",
};

const PROFILE_WEIGHTS: Record<EvaluationProfile, Record<PillarKey, number>> = {
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

const CHECK_FIXES: Record<string, string> = {
  D1: "Publish /.well-known/air.json and link to your API and docs.",
  D2: "Make entrypoints return 200 with the right content type every time.",
  D3: "Align URLs across air.json, OpenAPI, and docs.",
  D4: "Allow /.well-known, /openapi.*, and docs paths in robots.txt.",
  C2: "Publish a clear API description file with endpoints and examples.",
  C3: "Ensure /mcp returns explainer text on GET and JSON-RPC initialize on POST.",
  L1: "Publish a public /docs page and link it from air.json.",
  L4: "Fix or remove broken docs links.",
  R3: "Remove random output (timestamps, IDs) from critical pages.",
  T1: "Fill all required fields in air.json (contact, legal, verification, callable).",
  T2: "Ensure ai-plugin.json includes contact_email and a legal_info_url with /terms.",
};

const PILLAR_ACTIONS: Record<PillarKey, string[]> = {
  discovery: [
    "Add /.well-known/air.json with links to your API and docs.",
    "Mirror your API description at /.well-known/openapi.json and /openapi.json.",
  ],
  callableSurface: [
    "Publish a clear API description file (OpenAPI) with endpoints and examples.",
    "Add example requests and responses so tools can call correctly.",
  ],
  llmIngestion: [
    "Publish a stable docs page with clear headings and examples.",
    "Add llms.txt so agents can find the docs quickly.",
  ],
  trust: [
    "Complete air.json with contact, legal, and verification fields.",
    "Add contact and legal URLs in ai-plugin.json.",
  ],
  reliability: [
    "Keep critical pages stable for the same inputs.",
    "Avoid redirects that change behavior across retries.",
  ],
};

const CHECK_PILLAR_BY_PREFIX: Record<string, PillarKey> = {
  D: "discovery",
  C: "callableSurface",
  L: "llmIngestion",
  T: "trust",
  R: "reliability",
};

function inferPillar(checkId: string): PillarKey | undefined {
  const prefix = checkId.trim().charAt(0).toUpperCase();
  return CHECK_PILLAR_BY_PREFIX[prefix];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function crossProjectFooterHtml(): string {
  return `<footer data-cross-project-footer style="margin-top:24px;padding-top:14px;border-top:1px solid #d8d8d2;color:#555;font-size:13px">Cross-project: <a href="${SIBLING_A2ABENCH_URL}/stats">A2ABench</a> · <a href="${SIBLING_RAGMAP_URL}/stats">Ragmap</a> · <a href="${SIBLING_ROOTFETCH_URL}/stats">Rootfetch</a> · <a href="${SIBLING_RELAYORB_URL}/stats">RelayOrb</a> · <a href="${SIBLING_AISTATUSDASHBOARD_URL}/stats">AIStatusDashboard</a> — benchmark · MCP search · DNS delegation · tool control plane · status monitoring</footer>`;
}

function renderReportHtml(baseUrl: string, domain: string, report?: EvaluationResult): string {
  const normalizedDomain = domain.trim().toLowerCase();
  const isShowcase =
    normalizedDomain === "aistatusdashboard.com" || normalizedDomain === "www.aistatusdashboard.com";
  const canonicalUrl = `${baseUrl}/reports/${encodeURIComponent(domain)}`;
  const ogImage = `${baseUrl}/og.png`;
  const status = report?.status ?? "missing";
  const hasReport = status === "complete";
  const score = hasReport ? report?.score ?? 0 : null;
  const grade = hasReport ? report?.grade ?? "" : "";

  const title = hasReport
    ? `Agentability report for ${domain} - ${score}/100`
    : `Agentability report for ${domain}`;
  const description = hasReport
    ? `Agentability report for ${domain}. Score ${score}/100 (${grade}) in public mode.`
    : DEFAULT_DESCRIPTION;

  const robots = hasReport ? ROBOTS_INDEX : "noindex,nofollow";

  const checks = report?.checks ?? [];
  const issues = checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "fail" ? -1 : 1;
      }
      const order = { high: 0, medium: 1, low: 2 } as const;
      return order[a.severity] - order[b.severity];
    });

  const weights = report ? PROFILE_WEIGHTS[report.profile] : PROFILE_WEIGHTS.auto;
  const pillarCounts: Record<PillarKey, number> = {
    discovery: 0,
    callableSurface: 0,
    llmIngestion: 0,
    trust: 0,
    reliability: 0,
  };
  for (const check of checks) {
    const pillar = inferPillar(check.id);
    if (pillar) {
      pillarCounts[pillar] += 1;
    }
  }
  const missingPillars = (Object.keys(weights) as PillarKey[]).filter(
    (pillar) => weights[pillar] > 0 && pillarCounts[pillar] === 0
  );
  const missingLabels = missingPillars.map((pillar) => PILLAR_LABELS[pillar]).join(", ");
  const scoreCap = Math.round(
    100 - missingPillars.reduce((sum, pillar) => sum + weights[pillar] * 100, 0)
  );

  const recommendationSet = new Set<string>();
  for (const issue of issues) {
    const fix = CHECK_FIXES[issue.id];
    if (fix) recommendationSet.add(fix);
  }
  for (const pillar of missingPillars) {
    for (const action of PILLAR_ACTIONS[pillar]) {
      recommendationSet.add(action);
    }
  }
  const recommendations = Array.from(recommendationSet).slice(0, 6);

  const issuesHtml = issues.length
    ? `<ul>${issues
        .map(
          (issue) =>
            `<li><strong>${escapeHtml(issue.id)}</strong> — ${escapeHtml(
              issue.summary
            )}${CHECK_FIXES[issue.id] ? ` <span>Fix: ${escapeHtml(CHECK_FIXES[issue.id])}</span>` : ""}</li>`
        )
        .join("")}</ul>`
    : "<p>All public checks passed.</p>";

  const recommendationsHtml = recommendations.length
    ? `<ul>${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>Keep your public surfaces stable as you expand documentation and tooling.</p>";

  const scoreNote =
    hasReport && score !== null && score < 100 && missingPillars.length
      ? `<p>Public mode v1 does not score ${escapeHtml(
          missingLabels
        )} yet, so the highest possible score right now is about ${scoreCap}.</p>`
      : "";

  const cssLink = SSR_ASSETS.cssHref
    ? `<link rel="stylesheet" crossorigin href="${SSR_ASSETS.cssHref}">`
    : "";
  const scriptTag = `<script type="module" crossorigin src="${SSR_ASSETS.scriptSrc}"></script>`;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    datePublished: report?.completedAt ?? report?.createdAt ?? new Date().toISOString(),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: baseUrl,
    },
    url: canonicalUrl,
    about: {
      "@type": "Thing",
      name: domain,
    },
  };
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonicalUrl}" />
    ${report?.runId ? `<meta name="agentability:runId" content="${escapeHtml(report.runId)}" />` : ""}
    ${typeof report?.score === "number" ? `<meta name="agentability:score" content="${escapeHtml(String(report.score))}" />` : ""}
    ${report?.grade ? `<meta name="agentability:grade" content="${escapeHtml(report.grade)}" />` : ""}
    ${report?.completedAt ? `<meta name="agentability:completedAt" content="${escapeHtml(report.completedAt)}" />` : ""}
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ogImage}" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #f8fafc; color: #0f172a; }
      .card { max-width: 880px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08); }
      .headline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      .badge { display: inline-flex; align-items: center; border: 1px solid #cbd5f5; color: #1e293b; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; background: #f8fafc; }
      .notice { margin: 12px 0 0; border: 1px solid #bbf7d0; background: #ecfdf3; color: #065f46; padding: 12px 14px; border-radius: 12px; font-size: 14px; }
      h2 { margin: 24px 0 8px; font-size: 18px; }
      p { margin: 6px 0; line-height: 1.5; }
      ul { padding-left: 20px; }
      li { margin-bottom: 6px; line-height: 1.5; }
      .score { font-size: 20px; font-weight: 600; }
      .meta { color: #475569; font-size: 14px; }
      .cta a { color: #0f766e; text-decoration: none; font-weight: 600; }
    </style>
    <script type="application/ld+json">${structuredDataJson}</script>
    ${cssLink}
    ${scriptTag}
  </head>
  <body>
    <div id="root">
      <div class="card">
        <p class="meta">${SITE_NAME} report</p>
        <div class="headline">
          <h1>${escapeHtml(domain)}</h1>
          ${isShowcase ? '<span class="badge">Showcase example</span>' : ""}
        </div>
        ${
          isShowcase
            ? "<div class=\"notice\">This report is a public demo to showcase Agentability scoring and recommendations.</div>"
            : ""
        }
        ${
          hasReport
            ? `<p class="score">Score ${score}/100 (${escapeHtml(grade || "N/A")})</p>`
            : "<p class=\"score\">Report not found yet</p>"
        }
        <p>${escapeHtml(description)}</p>
        ${scoreNote}
        <h2>What needs attention</h2>
        ${issuesHtml}
        <h2>Concrete recommendations</h2>
        ${recommendationsHtml}
        <p class="cta"><a href="${canonicalUrl}">Open the full interactive report →</a></p>
        <h2>Embed badge</h2>
        <p>HTML</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;"><code>${escapeHtml(`<a href="${baseUrl}/reports/${encodeURIComponent(domain)}?via=badge"><img src="${baseUrl}/badge/${encodeURIComponent(domain)}.svg" alt="Agentability score for ${domain}" /></a>`)}</code></pre>
        <p>Markdown</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;"><code>${escapeHtml(`[![Agentability score for ${domain}](${baseUrl}/badge/${encodeURIComponent(domain)}.svg)](${baseUrl}/reports/${encodeURIComponent(domain)}?via=badge)`)}</code></pre>
        <p>Badge URL: <a href="${baseUrl}/badge/${encodeURIComponent(domain)}.svg">${baseUrl}/badge/${encodeURIComponent(domain)}.svg</a></p>
        ${crossProjectFooterHtml()}
      </div>
    </div>
  </body>
</html>`;
}

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type EvaluateOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; status: number; message: string; code: string; details?: unknown };

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_SERVER_INFO = {
  name: "agentability",
  version: AGENTABILITY_VERSION,
};

const mcpTools = [
  {
    name: "evaluate_site",
    description: "Run a public-mode agent readiness evaluation for a site origin.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      properties: {
        origin: { type: "string", format: "uri" },
        profile: {
          type: "string",
          enum: ["auto", "api_product", "docs_platform", "content", "hybrid"],
        },
      },
    },
  },
  {
    name: "get_run",
    description: "Fetch the status of a run by runId.",
    inputSchema: {
      type: "object",
      required: ["runId"],
      properties: {
        runId: { type: "string" },
      },
    },
  },
  {
    name: "get_latest",
    description: "Fetch the latest evaluation for a domain.",
    inputSchema: {
      type: "object",
      required: ["domain"],
      properties: {
        domain: { type: "string" },
      },
    },
  },
];

function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function isJsonRpcRequest(payload: unknown): payload is JsonRpcRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return record.jsonrpc === "2.0" && typeof record.method === "string";
}

function toMcpContent(result: unknown): { content: { type: "text"; text: string }[]; isError: false } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: false,
  };
}

async function runEvaluation(
  req: express.Request,
  payload: Record<string, unknown>
): Promise<EvaluateOutcome> {
  const rawOrigin = typeof payload.origin === "string" ? payload.origin : "";
  const coerced = { ...payload, origin: coerceOrigin(rawOrigin) };
  const parseResult = EvaluationInputSchema.safeParse(coerced);
  if (!parseResult.success) {
    return {
      ok: false,
      status: 400,
      message: "Invalid request",
      code: "invalid_request",
      details: parseResult.error.flatten(),
    };
  }

  const ip = getRequestIp(req);
  try {
    await enforceRateLimit(ip);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        status: 429,
        message: "Too many audits from this network. Please wait and try again.",
        code: "rate_limited",
        details: error.details,
      };
    }
    logger.warn("Rate limit check failed", error);
    return {
      ok: false,
      status: 503,
      message: "Temporarily unable to accept audits. Please try again in a minute.",
      code: "rate_limit_unavailable",
    };
  }

  let normalized: { origin: string; domain: string };
  try {
    normalized = await ensureResolvableDomain(parseResult.data.origin);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      message: "Domain does not resolve. Check the hostname.",
      code: "invalid_domain",
    };
  }

  const runId = crypto.randomUUID();
  const { origin, domain } = normalized;
  const baseUrl = buildBaseUrl(req);

  let evaluation: EvaluationResult | null = null;

  try {
    const domainRef = db.collection("evaluations").doc(domain);
    const domainSnap = await domainRef.get();
    const previousRunId = domainSnap.exists
      ? (domainSnap.data()?.latestRunId as string | undefined)
      : undefined;

    const runRef = domainRef.collection("runs").doc(runId);
    const runRootRef = db.collection("runs").doc(runId);

    const baseRun = {
      runId,
      domain,
      mode: "public",
      status: "running",
      input: { origin },
      createdAt: new Date().toISOString(),
      previousRunId,
    };

    await runRef.set(baseRun);
    await runRootRef.set(baseRun);

    const finalizeEvaluation = async (result: EvaluationResult, evidence: unknown[]) => {
      evaluation = { ...result, runId, previousRunId };
      const artifacts = {
        reportUrl: `${baseUrl}/reports/${result.domain}`,
        jsonUrl: `${baseUrl}/v1/evaluations/${result.domain}/latest.json`,
      } as EvaluationResult["artifacts"];

      const evidenceUpload = await uploadEvidenceBundle(result.domain, runId, evidence);
      if (evidenceUpload.evidenceBundleUrl) {
        artifacts.evidenceBundleUrl = evidenceUpload.evidenceBundleUrl;
      }

      let diffSummary = null;
      if (previousRunId) {
        const previousSnap = await runRef.parent.doc(previousRunId).get();
        if (previousSnap.exists) {
          const previous = previousSnap.data() as EvaluationResult;
          diffSummary = computeDiff(
            {
              score: previous.score,
              grade: previous.grade,
              pillarScores: previous.pillarScores,
              checks: previous.checks,
            },
            {
              score: evaluation.score,
              grade: evaluation.grade,
              pillarScores: evaluation.pillarScores,
              checks: evaluation.checks,
            }
          );
        }
      }

      evaluation = {
        ...evaluation,
        status: "complete",
        artifacts,
        completedAt: new Date().toISOString(),
        diffSummary: diffSummary ?? undefined,
      };

      await runRef.set(evaluation, { merge: true });
      await runRootRef.set(evaluation, { merge: true });

      await domainRef.set(
        {
          domain: result.domain,
          latestRunId: runId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      void updateLeaderboardSnapshotForCompletedRun(result.domain, {
        score: evaluation.score,
        grade: evaluation.grade,
        runId,
        completedAt: evaluation.completedAt ?? new Date().toISOString(),
      }).catch((error) => {
        logger.warn("Incremental leaderboard snapshot update failed", error);
      });

      return {
        jsonUrl: `${baseUrl}/v1/evaluations/${result.domain}/latest.json`,
        reportUrl: `${baseUrl}/reports/${result.domain}`,
      };
    };

    const evaluationPromise = evaluatePublic({ ...parseResult.data, origin });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const outcome = await Promise.race([evaluationPromise, timeoutPromise]);

    if (!outcome) {
      const jsonUrl = `${baseUrl}/v1/evaluations/${domain}/latest.json`;
      const reportUrl = `${baseUrl}/reports/${domain}`;
      const statusUrl = `${baseUrl}/v1/runs/${runId}`;

      void evaluationPromise
        .then((final) => finalizeEvaluation(final.result, final.evidence))
        .catch(async (error) => {
          logger.error("Evaluation failed (async)", error);
          await runRef.set(
            {
              runId,
              domain,
              status: "failed",
              error: String(error),
              completedAt: new Date().toISOString(),
            },
            { merge: true }
          );
          await runRootRef.set(
            {
              runId,
              domain,
              status: "failed",
              error: String(error),
              completedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        });

      return {
        ok: true,
        result: {
          runId,
          status: "running",
          jsonUrl,
          reportUrl,
          statusUrl,
          domain,
        },
      };
    }

    const { result, evidence } = outcome;
    const finalUrls = await finalizeEvaluation(result, evidence);
    const statusUrl = `${baseUrl}/v1/runs/${runId}`;
    return {
      ok: true,
      result: {
        runId,
        status: "complete",
        jsonUrl: finalUrls.jsonUrl,
        reportUrl: finalUrls.reportUrl,
        statusUrl,
        domain: result.domain,
      },
    };
  } catch (error) {
    logger.error("Evaluation failed", error);
    const runRef = db
      .collection("evaluations")
      .doc(domain)
      .collection("runs")
      .doc(runId);
    await runRef.set(
      {
        ...(evaluation ?? {}),
        runId,
        domain,
        status: "failed",
        error: String(error),
        completedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await db
      .collection("runs")
      .doc(runId)
      .set(
        {
          ...(evaluation ?? {}),
          runId,
          domain,
          status: "failed",
          error: String(error),
          completedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    // Treat internal evaluation errors like a job that failed fast: return the runId so the
    // client can show the run page and error details, instead of a generic 500 with no context.
    const baseUrl = buildBaseUrl(req);
    return {
      ok: true,
      result: {
        runId,
        status: "failed",
        jsonUrl: `${baseUrl}/v1/evaluations/${domain}/latest.json`,
        reportUrl: `${baseUrl}/reports/${domain}`,
        statusUrl: `${baseUrl}/v1/runs/${runId}`,
        domain,
      },
    };
  }
}

async function uploadEvidenceBundle(
  domain: string,
  runId: string,
  evidence: unknown[]
): Promise<{ evidenceBundleUrl?: string; storagePath?: string }> {
  const bucket = evidenceBucketName ? storage.bucket(evidenceBucketName) : storage.bucket();
  const path = `evidence/${domain}/${runId}.jsonl`;
  const payload = evidence.map((record) => JSON.stringify(record)).join("\n");
  await bucket.file(path).save(payload, {
    contentType: "application/jsonl",
  });

  try {
    const [signedUrl] = await bucket.file(path).getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
    });
    return { evidenceBundleUrl: signedUrl, storagePath: `gs://${bucket.name}/${path}` };
  } catch (error) {
    logger.warn("Evidence bundle signed URL failed", error);
    return { storagePath: `gs://${bucket.name}/${path}` };
  }
}

type AgentabilityPublicStats = {
  audits_run_total: number;
  distinct_domains_audited: number;
  audits_run_7d: number;
  audits_run_30d: number;
  median_audit_duration_seconds: number;
  p95_audit_duration_seconds: number;
  last_run_id: string | null;
  last_run_ts: string | null;
  score_distribution_30d: {
    A: number;
    B: number;
    C: number;
    D: number;
    F: number;
  };
  generated_at: string;
  siblings: Record<string, SiblingStatsLink>;
};

const AGENTABILITY_STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const AGENTABILITY_STATS_STALE_MS = 15 * 60 * 1000;
const AGENTABILITY_PUBLIC_STATS_DOC = "publicStats";
let agentabilityStatsCache:
  | {
      fetchedAt: number;
      payload: AgentabilityPublicStats;
    }
  | null = null;
let agentabilityStatsInFlight: Promise<AgentabilityPublicStats> | null = null;

function parseIsoDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

async function countCollection(collectionName: string): Promise<number> {
  const collection = db.collection(collectionName);
  try {
    const aggregate = await collection.count().get();
    const count = aggregate.data().count;
    if (typeof count === "number") return count;
  } catch (error) {
    logger.warn(`Count aggregation failed for ${collectionName}; falling back to scan`, error);
  }
  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query: FirebaseFirestore.Query = collection.orderBy("__name__").limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    total += page.size;
    if (page.size < 500) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return total;
}

async function loadAgentabilityPublicStats(): Promise<AgentabilityPublicStats> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [auditsRunTotal, distinctDomainsAudited, recentRunsSnap] = await Promise.all([
    countCollection("runs"),
    countCollection("evaluations"),
    db.collection("runs").orderBy("createdAt", "desc").limit(5000).get(),
  ]);

  let auditsRun7d = 0;
  let auditsRun30d = 0;
  let lastRunId: string | null = null;
  let lastRunTs: string | null = null;
  let lastRunEpoch = 0;
  const durationsSeconds: number[] = [];
  const scoreDistribution30d = { A: 0, B: 0, C: 0, D: 0, F: 0 };

  for (const doc of recentRunsSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const createdAt = parseIsoDateOrNull(data.createdAt);
    const completedAt = parseIsoDateOrNull(data.completedAt);
    const status = typeof data.status === "string" ? data.status : "";
    const grade = typeof data.grade === "string" ? data.grade.toUpperCase() : "";

    if (createdAt && createdAt.toISOString() >= sevenDaysAgo) auditsRun7d += 1;
    if (createdAt && createdAt.toISOString() >= thirtyDaysAgo) auditsRun30d += 1;

    if (status === "complete" && completedAt && createdAt) {
      const durationSeconds = Math.max(0, (completedAt.getTime() - createdAt.getTime()) / 1000);
      if (Number.isFinite(durationSeconds)) durationsSeconds.push(durationSeconds);

      if (completedAt.toISOString() >= thirtyDaysAgo) {
        if (grade in scoreDistribution30d) {
          scoreDistribution30d[grade as keyof typeof scoreDistribution30d] += 1;
        } else {
          scoreDistribution30d.F += 1;
        }
      }

      if (completedAt.getTime() > lastRunEpoch) {
        lastRunEpoch = completedAt.getTime();
        lastRunTs = completedAt.toISOString();
        lastRunId = typeof data.runId === "string" && data.runId ? data.runId : doc.id;
      }
    }
  }

  const payload: AgentabilityPublicStats = {
    audits_run_total: auditsRunTotal,
    distinct_domains_audited: distinctDomainsAudited,
    audits_run_7d: auditsRun7d,
    audits_run_30d: auditsRun30d,
    median_audit_duration_seconds: Number(percentile(durationsSeconds, 50).toFixed(3)),
    p95_audit_duration_seconds: Number(percentile(durationsSeconds, 95).toFixed(3)),
    last_run_id: lastRunId,
    last_run_ts: lastRunTs,
    score_distribution_30d: scoreDistribution30d,
    generated_at: generatedAt,
    siblings: siblingLinksForStats(),
  };
  try {
    await db.collection("meta").doc(AGENTABILITY_PUBLIC_STATS_DOC).set(
      {
        payload,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    logger.warn("Persist public stats snapshot failed", error);
  }
  return payload;
}

function emptyAgentabilityStatsPayload(generatedAt: string): AgentabilityPublicStats {
  return {
    audits_run_total: 0,
    distinct_domains_audited: 0,
    audits_run_7d: 0,
    audits_run_30d: 0,
    median_audit_duration_seconds: 0,
    p95_audit_duration_seconds: 0,
    last_run_id: null,
    last_run_ts: null,
    score_distribution_30d: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    generated_at: generatedAt,
    siblings: siblingLinksForStats(),
  };
}

function isAgentabilityPublicStatsCandidate(value: unknown): value is AgentabilityPublicStats {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.audits_run_total === "number" &&
    typeof candidate.distinct_domains_audited === "number" &&
    typeof candidate.audits_run_7d === "number" &&
    typeof candidate.audits_run_30d === "number" &&
    typeof candidate.generated_at === "string" &&
    !!candidate.siblings &&
    typeof candidate.siblings === "object"
  );
}

async function readPersistedAgentabilityPublicStats(): Promise<AgentabilityPublicStats | null> {
  try {
    const snap = await db.collection("meta").doc(AGENTABILITY_PUBLIC_STATS_DOC).get();
    if (!snap.exists) return null;
    const payload = snap.data()?.payload;
    if (!isAgentabilityPublicStatsCandidate(payload)) return null;
    return payload;
  } catch (error) {
    logger.warn("Read persisted public stats snapshot failed", error);
    return null;
  }
}

function startAgentabilityStatsRefresh(): Promise<AgentabilityPublicStats> {
  if (!agentabilityStatsInFlight) {
    agentabilityStatsInFlight = (async () => {
      const payload = await loadAgentabilityPublicStats();
      agentabilityStatsCache = {
        fetchedAt: Date.now(),
        payload,
      };
      return payload;
    })()
      .catch((error) => {
        logger.error("Agentability stats load failed", error);
        if (agentabilityStatsCache) {
          return {
            ...agentabilityStatsCache.payload,
            generated_at: new Date().toISOString(),
          };
        }
        return emptyAgentabilityStatsPayload(new Date().toISOString());
      })
      .finally(() => {
        agentabilityStatsInFlight = null;
      });
  }
  return agentabilityStatsInFlight;
}

async function getAgentabilityPublicStats(): Promise<AgentabilityPublicStats> {
  const now = Date.now();
  if (agentabilityStatsCache && now - agentabilityStatsCache.fetchedAt < AGENTABILITY_STATS_CACHE_TTL_MS) {
    return agentabilityStatsCache.payload;
  }

  if (agentabilityStatsCache) {
    if (now - agentabilityStatsCache.fetchedAt >= AGENTABILITY_STATS_CACHE_TTL_MS) {
      void startAgentabilityStatsRefresh();
    }
    return agentabilityStatsCache.payload;
  }

  const persisted = await readPersistedAgentabilityPublicStats();
  if (persisted) {
    const ageMs = Math.max(0, now - Date.parse(persisted.generated_at || ""));
    agentabilityStatsCache = { fetchedAt: now, payload: persisted };
    if (!Number.isFinite(ageMs) || ageMs >= AGENTABILITY_STATS_STALE_MS) {
      void startAgentabilityStatsRefresh();
    }
    return persisted;
  }

  return startAgentabilityStatsRefresh();
}

function renderStatsHtml(payload: AgentabilityPublicStats): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentability stats</title>
    <meta name="description" content="Server-rendered Agentability public counters and distribution." />
    <style>
      body { margin: 32px auto; max-width: 920px; padding: 0 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #0f172a; }
      h1 { margin-bottom: 6px; }
      .muted { color: #475569; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #d9d9d9; padding: 8px 10px; text-align: left; }
      th { background: #f8fafc; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      a { color: #0b57d0; }
      .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Agentability stats</h1>
    <p class="muted">Generated ${escapeHtml(payload.generated_at)} · JSON: <a href="/stats.json">/stats.json</a></p>
    <table>
      <tbody>
        <tr><th>Audits run total</th><td class="num">${payload.audits_run_total}</td></tr>
        <tr><th>Distinct domains audited</th><td class="num">${payload.distinct_domains_audited}</td></tr>
        <tr><th>Audits run (7d)</th><td class="num">${payload.audits_run_7d}</td></tr>
        <tr><th>Audits run (30d)</th><td class="num">${payload.audits_run_30d}</td></tr>
        <tr><th>Median audit duration (seconds)</th><td class="num">${payload.median_audit_duration_seconds}</td></tr>
        <tr><th>P95 audit duration (seconds)</th><td class="num">${payload.p95_audit_duration_seconds}</td></tr>
        <tr><th>Last run ID</th><td>${escapeHtml(payload.last_run_id ?? "n/a")}</td></tr>
        <tr><th>Last run timestamp</th><td>${escapeHtml(payload.last_run_ts ?? "n/a")}</td></tr>
      </tbody>
    </table>
    <p class="muted">Score distribution (30d)</p>
    <div class="chips">
      <span class="chip">A: ${payload.score_distribution_30d.A}</span>
      <span class="chip">B: ${payload.score_distribution_30d.B}</span>
      <span class="chip">C: ${payload.score_distribution_30d.C}</span>
      <span class="chip">D: ${payload.score_distribution_30d.D}</span>
      <span class="chip">F: ${payload.score_distribution_30d.F}</span>
    </div>
    <p><a href="/">Back to homepage</a></p>
    ${crossProjectFooterHtml()}
  </body>
</html>`;
}

type PublicLeaderboardEntry = {
  domain: string;
  score: number;
  grade: string;
  runId: string;
  completedAt: string;
  reportUrl: string;
};

type PublicLeaderboardSnapshotEntry = {
  domain: string;
  score: number;
  grade: string;
  runId: string;
  completedAt: string;
};

type PublicLeaderboardSnapshot = {
  updatedAt: string;
  generatedAt: string;
  entries: PublicLeaderboardSnapshotEntry[];
};

const AGENTABILITY_PUBLIC_LEADERBOARD_DOC = "publicLeaderboard";
const AGENTABILITY_LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const AGENTABILITY_LEADERBOARD_STALE_MS = 15 * 60 * 1000;
let leaderboardCache:
  | {
      fetchedAt: number;
      payload: PublicLeaderboardSnapshot;
    }
  | null = null;
let leaderboardInFlight: Promise<PublicLeaderboardSnapshot> | null = null;

function mapLeaderboardEntries(baseUrl: string, entries: PublicLeaderboardSnapshotEntry[]): PublicLeaderboardEntry[] {
  return entries.map((entry) => ({
    domain: entry.domain,
    score: entry.score,
    grade: entry.grade,
    runId: entry.runId,
    completedAt: entry.completedAt,
    reportUrl: `/reports/${encodeURIComponent(entry.domain)}`,
  }));
}

function emptyLeaderboardSnapshot(): PublicLeaderboardSnapshot {
  const nowIso = new Date().toISOString();
  return {
    updatedAt: nowIso,
    generatedAt: nowIso,
    entries: [],
  };
}

function isLeaderboardSnapshotCandidate(value: unknown): value is PublicLeaderboardSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.generatedAt !== "string" ||
    !Array.isArray(candidate.entries)
  ) {
    return false;
  }
  return candidate.entries.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Record<string, unknown>;
    return (
      typeof row.domain === "string" &&
      typeof row.score === "number" &&
      typeof row.grade === "string" &&
      typeof row.runId === "string" &&
      typeof row.completedAt === "string"
    );
  });
}

async function readPersistedLeaderboardSnapshot(): Promise<PublicLeaderboardSnapshot | null> {
  try {
    const snap = await db.collection("meta").doc(AGENTABILITY_PUBLIC_LEADERBOARD_DOC).get();
    if (!snap.exists) return null;
    const payload = snap.data()?.payload;
    if (!isLeaderboardSnapshotCandidate(payload)) return null;
    return payload;
  } catch (error) {
    logger.warn("Read persisted leaderboard snapshot failed", error);
    return null;
  }
}

async function persistLeaderboardSnapshot(snapshot: PublicLeaderboardSnapshot): Promise<void> {
  try {
    await db.collection("meta").doc(AGENTABILITY_PUBLIC_LEADERBOARD_DOC).set(
      {
        payload: snapshot,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    logger.warn("Persist leaderboard snapshot failed", error);
  }
}

async function updateLeaderboardSnapshotForCompletedRun(
  domain: string,
  completed: { score: number; grade: string; runId: string; completedAt: string }
): Promise<void> {
  const nowIso = new Date().toISOString();
  const snapshot = (await readPersistedLeaderboardSnapshot()) ?? emptyLeaderboardSnapshot();
  const nextEntries = snapshot.entries.filter((entry) => entry.domain !== domain);
  nextEntries.push({
    domain,
    score: Number.isFinite(completed.score) ? completed.score : 0,
    grade: completed.grade || "F",
    runId: completed.runId,
    completedAt: completed.completedAt || nowIso,
  });
  nextEntries.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  const updatedAt =
    nextEntries.reduce((latest, entry) => (entry.completedAt > latest ? entry.completedAt : latest), "") || nowIso;
  const nextSnapshot: PublicLeaderboardSnapshot = {
    updatedAt,
    generatedAt: nowIso,
    entries: nextEntries,
  };
  leaderboardCache = {
    fetchedAt: Date.now(),
    payload: nextSnapshot,
  };
  await persistLeaderboardSnapshot(nextSnapshot);
}

async function rebuildPublicLeaderboardSnapshot(): Promise<PublicLeaderboardSnapshot> {
  const entries: PublicLeaderboardSnapshotEntry[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const runRefBatchSize = 250;

  while (true) {
    let query: FirebaseFirestore.Query = db.collection("evaluations").orderBy("__name__").limit(500);
    if (cursor) query = query.startAfter(cursor);
    const evaluations = await query.get();
    if (evaluations.empty) break;

    const runRefs: FirebaseFirestore.DocumentReference[] = [];
    const runRefMeta: Array<{ domain: string; latestRunId: string }> = [];
    for (const evaluation of evaluations.docs) {
      const domain = evaluation.id;
      const latestRunId = evaluation.data()?.latestRunId as string | undefined;
      if (!latestRunId) continue;
      runRefs.push(db.collection("evaluations").doc(domain).collection("runs").doc(latestRunId));
      runRefMeta.push({ domain, latestRunId });
    }

    for (let start = 0; start < runRefs.length; start += runRefBatchSize) {
      const refs = runRefs.slice(start, start + runRefBatchSize);
      const refsMeta = runRefMeta.slice(start, start + runRefBatchSize);
      const runDocs = await db.getAll(...refs);
      for (let idx = 0; idx < runDocs.length; idx += 1) {
        const runDoc = runDocs[idx];
        const meta = refsMeta[idx];
        if (!meta || !runDoc.exists) continue;
        const run = runDoc.data() as Record<string, unknown>;
        const status = typeof run.status === "string" ? run.status : "";
        if (status !== "complete") continue;
        const score = Number(run.score ?? 0);
        const grade = typeof run.grade === "string" ? run.grade : "F";
        const completedAt = typeof run.completedAt === "string" ? run.completedAt : new Date().toISOString();
        const runId = typeof run.runId === "string" && run.runId ? run.runId : meta.latestRunId;
        entries.push({
          domain: meta.domain,
          score,
          grade,
          runId,
          completedAt,
        });
      }
    }

    if (evaluations.size < 500) break;
    cursor = evaluations.docs[evaluations.docs.length - 1];
  }

  entries.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  const nowIso = new Date().toISOString();
  const updatedAt =
    entries.reduce((latest, entry) => (entry.completedAt > latest ? entry.completedAt : latest), "") || nowIso;
  const snapshot: PublicLeaderboardSnapshot = {
    updatedAt,
    generatedAt: nowIso,
    entries,
  };
  await persistLeaderboardSnapshot(snapshot);
  return snapshot;
}

function startLeaderboardRefresh(): Promise<PublicLeaderboardSnapshot> {
  if (!leaderboardInFlight) {
    leaderboardInFlight = (async () => {
      const snapshot = await rebuildPublicLeaderboardSnapshot();
      leaderboardCache = {
        fetchedAt: Date.now(),
        payload: snapshot,
      };
      return snapshot;
    })()
      .catch((error) => {
        logger.error("Leaderboard snapshot rebuild failed", error);
        if (leaderboardCache) {
          return leaderboardCache.payload;
        }
        return emptyLeaderboardSnapshot();
      })
      .finally(() => {
        leaderboardInFlight = null;
      });
  }
  return leaderboardInFlight;
}

async function getPublicLeaderboard(baseUrl: string): Promise<{
  updatedAt: string;
  entries: PublicLeaderboardEntry[];
}> {
  const now = Date.now();
  if (leaderboardCache && now - leaderboardCache.fetchedAt < AGENTABILITY_LEADERBOARD_CACHE_TTL_MS) {
    return {
      updatedAt: leaderboardCache.payload.updatedAt,
      entries: mapLeaderboardEntries(baseUrl, leaderboardCache.payload.entries),
    };
  }

  if (leaderboardCache) {
    if (now - leaderboardCache.fetchedAt >= AGENTABILITY_LEADERBOARD_CACHE_TTL_MS) {
      void startLeaderboardRefresh();
    }
    return {
      updatedAt: leaderboardCache.payload.updatedAt,
      entries: mapLeaderboardEntries(baseUrl, leaderboardCache.payload.entries),
    };
  }

  const persisted = await readPersistedLeaderboardSnapshot();
  if (persisted) {
    const ageMs = Math.max(0, now - Date.parse(persisted.generatedAt || ""));
    leaderboardCache = { fetchedAt: now, payload: persisted };
    if (!Number.isFinite(ageMs) || ageMs >= AGENTABILITY_LEADERBOARD_STALE_MS) {
      void startLeaderboardRefresh();
    }
    return {
      updatedAt: persisted.updatedAt,
      entries: mapLeaderboardEntries(baseUrl, persisted.entries),
    };
  }

  const fresh = await startLeaderboardRefresh();
  return {
    updatedAt: fresh.updatedAt,
    entries: mapLeaderboardEntries(baseUrl, fresh.entries),
  };
}

function renderSitemapXml(baseUrl: string, entries: PublicLeaderboardEntry[]): string {
  const staticUrls = [
    { loc: `${baseUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/stats`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/stats.json`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/llms.txt`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/llms-full.txt`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/.well-known/air.json`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/.well-known/agent.json`, lastmod: new Date().toISOString() },
    { loc: `${baseUrl}/openapi.json`, lastmod: new Date().toISOString() },
  ];
  const reportUrls = entries.map((entry) => ({
    loc: `${baseUrl}/reports/${encodeURIComponent(entry.domain)}`,
    lastmod: entry.completedAt,
  }));
  const all = [...staticUrls, ...reportUrls];
  const body = all
    .map((item) => `  <url><loc>${escapeHtml(item.loc)}</loc><lastmod>${escapeHtml(item.lastmod)}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

app.get("/.well-known/agent.json", (req, res) => {
  const baseUrl = buildBaseUrl(req);
  res.set("Cache-Control", "public, max-age=60");
  return res.json({
    name: "Agentability",
    description: "Public-mode agent-readiness audit with evidence-backed reports.",
    url: baseUrl,
    version: AGENTABILITY_VERSION,
    documentationUrl: `${baseUrl}/docs.md`,
    apiEndpoints: {
      openapi: `${baseUrl}/openapi.json`,
      evaluate: `${baseUrl}/v1/evaluate`,
      run_status: `${baseUrl}/v1/runs/{runId}`,
      latest: `${baseUrl}/v1/evaluations/{domain}/latest.json`,
    },
    mcpServers: [
      {
        name: "agentability",
        transport: "streamable-http",
        url: `${baseUrl}/mcp`,
      },
    ],
    related: relatedProjectsForAgentCard(),
  });
});

app.get("/leaderboard.json", async (req, res) => {
  const baseUrl = buildBaseUrl(req);
  const leaderboard = await getPublicLeaderboard(baseUrl);
  res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
  return res.json({
    updatedAt: leaderboard.updatedAt,
    entries: leaderboard.entries.map((entry) => ({
      domain: entry.domain,
      score: entry.score,
      grade: entry.grade,
      reportUrl: entry.reportUrl,
    })),
  });
});

app.get("/sitemap.xml", async (req, res) => {
  const baseUrl = buildBaseUrl(req);
  const leaderboard = await getPublicLeaderboard(baseUrl);
  res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600");
  res.set("Content-Type", "application/xml; charset=utf-8");
  return res.status(200).send(renderSitemapXml(baseUrl, leaderboard.entries));
});

app.get("/stats.json", async (_req, res) => {
  const payload = await getAgentabilityPublicStats();
  res.set("Cache-Control", "public, max-age=60");
  return res.json(payload);
});

app.get("/stats", async (_req, res) => {
  const payload = await getAgentabilityPublicStats();
  res.set("Cache-Control", "public, max-age=60");
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(renderStatsHtml(payload));
});

app.get("/discovery/audit/latest.json", async (_req, res) => {
  const domain = "agentability.org";
  const run = await loadLatestEvaluationForDomain(domain);
  const generatedAt = new Date().toISOString();
  const payload = {
    generated_at: generatedAt,
    domain,
    runId: run?.runId ?? null,
    score: typeof run?.score === "number" ? run.score : null,
    grade: typeof run?.grade === "string" ? run.grade : null,
    completedAt: run?.completedAt ?? run?.createdAt ?? null,
    report_url: `${CANONICAL_BASE_URL}/reports/${domain}`,
    latest_json_url: `${CANONICAL_BASE_URL}/v1/evaluations/${domain}/latest.json`,
  };
  res.set("Cache-Control", "public, max-age=60");
  return res.status(200).json(payload);
});

app.get("/discovery/audit/latest.pretty.json", async (_req, res) => {
  const domain = "agentability.org";
  const run = await loadLatestEvaluationForDomain(domain);
  const generatedAt = new Date().toISOString();
  const payload = {
    generated_at: generatedAt,
    domain,
    runId: run?.runId ?? null,
    score: typeof run?.score === "number" ? run.score : null,
    grade: typeof run?.grade === "string" ? run.grade : null,
    completedAt: run?.completedAt ?? run?.createdAt ?? null,
    report_url: `${CANONICAL_BASE_URL}/reports/${domain}`,
    latest_json_url: `${CANONICAL_BASE_URL}/v1/evaluations/${domain}/latest.json`,
  };
  res.set("Cache-Control", "public, max-age=60");
  res.type("application/json");
  return res.status(200).send(`${JSON.stringify(payload, null, 2)}\n`);
});

app.post("/v1/evaluate", async (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const outcome = await runEvaluation(req, payload);
  if (!outcome.ok) {
    if (
      outcome.status === 429 &&
      outcome.code === "rate_limited" &&
      outcome.details &&
      typeof outcome.details === "object" &&
      "retryAfterSeconds" in outcome.details
    ) {
      const retryAfterSeconds = (outcome.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)) {
        res.set("Retry-After", String(Math.max(1, Math.floor(retryAfterSeconds))));
      }
    }
    return sendError(res, outcome.status, outcome.message, outcome.code, outcome.details);
  }
  return res.json(outcome.result);
});

app.get("/v1/evaluate", (_req, res) => {
  return res.json({
    message: "Use POST /v1/evaluate with a JSON body.",
    example: { origin: "https://example.com", profile: "auto" },
  });
});

app.get("/v1", (_req, res) => {
  return res.json({
    version: AGENTABILITY_VERSION,
    revision: AGENTABILITY_REVISION || null,
    endpoints: {
      evaluate: { method: "POST", path: "/v1/evaluate" },
      runStatus: { method: "GET", path: "/v1/runs/{runId}" },
      latest: { method: "GET", path: "/v1/evaluations/{domain}/latest.json" },
      subscribe: { method: "POST", path: "/v1/subscribe" },
      communityFix: { method: "GET", path: "/v1/community-fix?runId={runId}&issueId={issueId}" },
      report: { method: "GET", path: "/reports/{domain}" },
      mcp: { method: "POST", path: "/mcp" },
    },
  });
});

app.get("/mcp", (_req, res) => {
  res.set("Content-Type", "text/plain; charset=utf-8");
  return res.status(200).send(
    "Agentability MCP endpoint. POST JSON-RPC to /mcp to initialize and call tools."
  );
});

app.post("/mcp", async (req, res) => {
  const payload = req.body ?? {};
  if (!isJsonRpcRequest(payload)) {
    return res.json(jsonRpcError(null, -32600, "Invalid Request"));
  }

  const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
  const id = hasId ? (payload.id ?? null) : null;

  if (!hasId) {
    return res.status(204).end();
  }

  const { method, params } = payload;

  if (method === "initialize") {
    return res.json(
      jsonRpcSuccess(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: MCP_SERVER_INFO,
        capabilities: { tools: {} },
      })
    );
  }

  if (method === "initialized" || method === "ping") {
    return res.json(jsonRpcSuccess(id, {}));
  }

  if (method === "tools/list") {
    return res.json(jsonRpcSuccess(id, { tools: mcpTools }));
  }

  if (method === "tools/call") {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return res.json(jsonRpcError(id, -32602, "Invalid params"));
    }
    const paramRecord = params as Record<string, unknown>;
    const toolName = typeof paramRecord.name === "string" ? paramRecord.name : "";
    if (!toolName) {
      return res.json(
        jsonRpcError(id, -32602, "Invalid params", {
          fields: { name: "Required" },
        })
      );
    }

    const args =
      paramRecord.arguments && typeof paramRecord.arguments === "object" && !Array.isArray(paramRecord.arguments)
        ? (paramRecord.arguments as Record<string, unknown>)
        : {};

    if (toolName === "evaluate_site") {
      const outcome = await runEvaluation(req, args);
      if (!outcome.ok) {
        return res.json(
          jsonRpcError(id, -32000, outcome.message, {
            code: outcome.code,
            details: outcome.details,
          })
        );
      }
      return res.json(jsonRpcSuccess(id, toMcpContent(outcome.result)));
    }

    if (toolName === "get_run") {
      const runId = typeof args.runId === "string" ? args.runId : "";
      if (!runId) {
        return res.json(
          jsonRpcError(id, -32602, "Invalid params", {
            fields: { runId: "Required" },
          })
        );
      }
      const doc = await db.collection("runs").doc(runId).get();
      if (!doc.exists) {
        return res.json(jsonRpcError(id, -32000, "Run not found", { code: "not_found" }));
      }
      return res.json(jsonRpcSuccess(id, toMcpContent(doc.data())));
    }

    if (toolName === "get_latest") {
      const rawDomain = typeof args.domain === "string" ? args.domain : "";
      if (!rawDomain) {
        return res.json(
          jsonRpcError(id, -32602, "Invalid params", {
            fields: { domain: "Required" },
          })
        );
      }
      const domain = normalizeOrigin(rawDomain).domain;
      const parent = await db.collection("evaluations").doc(domain).get();
      if (!parent.exists) {
        return res.json(jsonRpcError(id, -32000, "Domain not found", { code: "not_found" }));
      }
      const latestRunId = parent.data()?.latestRunId as string | undefined;
      if (!latestRunId) {
        return res.json(
          jsonRpcError(id, -32000, "No evaluations yet", {
            code: "not_found",
            reason: "no_evaluations",
          })
        );
      }
      const run = await db
        .collection("evaluations")
        .doc(domain)
        .collection("runs")
        .doc(latestRunId)
        .get();
      if (!run.exists) {
        return res.json(jsonRpcError(id, -32000, "Run not found", { code: "not_found" }));
      }
      return res.json(jsonRpcSuccess(id, toMcpContent(run.data())));
    }

    return res.json(jsonRpcError(id, -32601, "Method not found"));
  }

  return res.json(jsonRpcError(id, -32601, "Method not found"));
});

async function loadLatestEvaluationForDomain(domain: string): Promise<EvaluationResult | null> {
  const parent = await db.collection("evaluations").doc(domain).get();
  const latestRunId = parent.exists ? (parent.data()?.latestRunId as string | undefined) : undefined;
  if (!latestRunId) return null;
  const run = await db
    .collection("evaluations")
    .doc(domain)
    .collection("runs")
    .doc(latestRunId)
    .get();
  if (!run.exists) return null;
  return run.data() as EvaluationResult;
}

function renderCertHtml(baseUrl: string, domain: string, report: EvaluationResult | null): string {
  const canonicalUrl = `${baseUrl}/cert/${encodeURIComponent(domain)}`;
  const hasReport = !!report && report.status === "complete";
  const score = hasReport ? Number(report?.score ?? 0).toFixed(1) : "n/a";
  const grade = hasReport ? String(report?.grade ?? "n/a") : "n/a";
  const runId = report?.runId ?? "n/a";
  const completedAt = report?.completedAt ?? report?.createdAt ?? null;
  const reportUrl = `${baseUrl}/reports/${encodeURIComponent(domain)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentability certificate - ${escapeHtml(domain)}</title>
    <meta name="description" content="Agentability certificate for ${escapeHtml(domain)}." />
    <link rel="canonical" href="${canonicalUrl}" />
    <style>
      body { margin: 40px auto; max-width: 900px; padding: 0 16px; font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
      .card { background: #fff; border: 1px solid #dbe3ef; border-radius: 16px; padding: 20px; }
      .score { font-size: 34px; font-weight: 700; margin: 8px 0; }
      .meta { color: #475569; }
      a { color: #0b57d0; }
      dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 12px; margin-top: 16px; }
      dt { color: #475569; }
      dd { margin: 0; }
    </style>
  </head>
  <body>
    <section class="card">
      <p class="meta">Agentability certificate</p>
      <h1 style="margin:0">${escapeHtml(domain)}</h1>
      <p class="score">Score ${escapeHtml(score)} (${escapeHtml(grade)})</p>
      <dl>
        <dt>Run ID</dt><dd>${escapeHtml(runId)}</dd>
        <dt>Completed at</dt><dd>${escapeHtml(completedAt ?? "n/a")}</dd>
        <dt>Report</dt><dd><a href="${reportUrl}">${reportUrl}</a></dd>
        <dt>Badge</dt><dd><a href="${baseUrl}/badge/${encodeURIComponent(domain)}.svg">${baseUrl}/badge/${encodeURIComponent(domain)}.svg</a></dd>
      </dl>
      ${crossProjectFooterHtml()}
    </section>
  </body>
</html>`;
}

app.get("/reports/:domain", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const baseUrl = buildBaseUrl(req);
  let report: EvaluationResult | undefined;

  try {
    report = (await loadLatestEvaluationForDomain(domain)) ?? undefined;
  } catch (error) {
    logger.warn("Report SSR failed", error);
  }

  const html = renderReportHtml(baseUrl, domain, report);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(html);
});

app.get("/cert/:domain", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const baseUrl = buildBaseUrl(req);
  let report: EvaluationResult | null = null;
  try {
    report = await loadLatestEvaluationForDomain(domain);
  } catch (error) {
    logger.warn("Certificate render failed", error);
  }
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  return res.status(report ? 200 : 404).send(renderCertHtml(baseUrl, domain, report));
});

app.get("/v1/runs/:runId", async (req, res) => {
  const runId = req.params.runId;
  const doc = await db.collection("runs").doc(runId).get();
  if (!doc.exists) {
    return sendError(res, 404, "Run not found", "not_found");
  }
  return res.json(doc.data());
});

app.get("/v1/community-fix", async (req, res) => {
  const runId = typeof req.query.runId === "string" ? req.query.runId : "";
  const issueId = typeof req.query.issueId === "string" ? req.query.issueId : "";
  const finding = typeof req.query.finding === "string" ? req.query.finding.trim() : "";

  if (finding && (!runId || !issueId)) {
    const query = `Agentability finding ${finding} remediation examples`;
    const payload = await resolveCommunityFix(query, "ad-hoc", finding);
    return res.json(payload);
  }

  if (!runId || !issueId) {
    return sendError(res, 400, "Missing runId+issueId or finding", "invalid_request");
  }

  try {
    await enforceCommunityFixRateLimit(getRequestIp(req));
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.set("Retry-After", String(Math.max(1, Math.floor(error.details.retryAfterSeconds))));
      return sendError(res, 429, "Too many requests. Please wait and try again.", "rate_limited", error.details);
    }
    logger.warn("Community-fix rate limit check failed", error);
    return sendError(
      res,
      503,
      "Temporarily unable to accept requests. Please try again in a minute.",
      "rate_limit_unavailable"
    );
  }

  const runDoc = await db.collection("runs").doc(runId).get();
  if (!runDoc.exists) {
    return sendError(res, 404, "Run not found", "not_found");
  }

  const runData = runDoc.data() as EvaluationResult;
  const check = runData.checks?.find((item) => item.id === issueId);
  if (!check) {
    return sendError(res, 404, "Issue not found", "not_found");
  }

  const cacheRef = db.collection("runs").doc(runId).collection("communityFixes").doc(issueId);
  const cacheSnap = await cacheRef.get();
  if (cacheSnap.exists) {
    const cached = cacheSnap.data() as Partial<CommunityFixPayload>;
    const sourceUrl =
      typeof cached.sourceUrl === "string" && cached.sourceUrl
        ? cached.sourceUrl
        : buildA2ABenchQuestionsUrl(A2ABENCH_BASE_URL);
    const results = Array.isArray(cached.results) ? cached.results : [];
    return res.json({
      status: cached.status === "available" || cached.status === "no_matches" || cached.status === "unavailable"
        ? cached.status
        : "no_matches",
      runId,
      issueId,
      query: typeof cached.query === "string" ? cached.query : "",
      cached: true,
      sourceUrl,
      results,
      createdAt: typeof cached.createdAt === "string" ? cached.createdAt : new Date().toISOString(),
      ...(typeof cached.error === "string" ? { error: cached.error } : {}),
    } satisfies CommunityFixPayload);
  }

  const fixIt = getFixIt(check.id, check.recommendationId);
  const query = buildCommunityFixQuery({
    issueId: check.id,
    summary: check.summary,
    recommendation: fixIt ?? undefined,
  });
  const payload = await resolveCommunityFix(query, runId, check.id);
  await cacheRef.set(payload, { merge: true });
  return res.json(payload);
});

app.post("/v1/subscribe", async (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const rawEmail = typeof payload.email === "string" ? payload.email : "";
  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return sendError(res, 400, "Invalid email address", "invalid_email");
  }

  const rawDomain = typeof payload.domain === "string" ? payload.domain : "";
  const domain = rawDomain.trim() ? normalizeOrigin(rawDomain).domain : undefined;
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";

  try {
    await enforceSubscribeRateLimit(getRequestIp(req));
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.set("Retry-After", String(Math.max(1, Math.floor(error.details.retryAfterSeconds))));
      return sendError(res, 429, "Too many requests. Please wait and try again.", "rate_limited", error.details);
    }
    logger.warn("Subscribe rate limit check failed", error);
    return sendError(
      res,
      503,
      "Temporarily unable to accept subscriptions. Please try again in a minute.",
      "rate_limit_unavailable"
    );
  }

  const id = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
  const ref = db.collection("subscriptions").doc(id);
  const ip = getRequestIp(req);
  const userAgent = req.header("user-agent") || "";

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const update: Record<string, unknown> = {
      email,
      lastIp: ip,
      userAgent,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      update.createdAt = FieldValue.serverTimestamp();
    }
    if (domain) {
      update.domains = FieldValue.arrayUnion(domain);
      update.lastDomain = domain;
    }
    if (runId) {
      update.runIds = FieldValue.arrayUnion(runId);
      update.lastRunId = runId;
    }

    tx.set(ref, update, { merge: true });
  });

  return res.json({
    status: "ok",
    email,
    domain: domain ?? null,
  });
});

app.get("/v1/evaluations/:domain/latest.json", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const parent = await db.collection("evaluations").doc(domain).get();
  if (!parent.exists) {
    return sendError(res, 404, "Domain not found", "not_found");
  }
  const latestRunId = parent.data()?.latestRunId as string | undefined;
  if (!latestRunId) {
    return sendError(res, 404, "No evaluations yet", "not_found", { reason: "no_evaluations" });
  }
  const run = await db
    .collection("evaluations")
    .doc(domain)
    .collection("runs")
    .doc(latestRunId)
    .get();
  if (!run.exists) {
    return sendError(res, 404, "Run not found", "not_found");
  }
  const runData = run.data() as EvaluationResult;
  let previousSummary: {
    score: number;
    grade: string;
    pillarScores: EvaluationResult["pillarScores"];
    completedAt?: string;
  } | null = null;

  if (runData.previousRunId) {
    const previousRun = await db
      .collection("evaluations")
      .doc(domain)
      .collection("runs")
      .doc(runData.previousRunId)
      .get();
    if (previousRun.exists) {
      const previous = previousRun.data() as EvaluationResult;
      previousSummary = {
        score: previous.score,
        grade: previous.grade,
        pillarScores: previous.pillarScores,
        completedAt: previous.completedAt ?? previous.createdAt,
      };
    }
  }

  return res.json({
    ...runData,
    previousRunId: runData.previousRunId,
    diff: runData.diffSummary ?? undefined,
    previousSummary: previousSummary ?? undefined,
  });
});

app.get("/v1/evaluations/:domain/:runId.json", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const runId = req.params.runId;
  const run = await db
    .collection("evaluations")
    .doc(domain)
    .collection("runs")
    .doc(runId)
    .get();
  if (!run.exists) {
    return sendError(res, 404, "Run not found", "not_found");
  }
  return res.json(run.data());
});

app.get("/badge/:domain.svg", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    const svg = renderBadgeSvg({ domain, statusLabel: "Invalid domain" });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(400).send(svg);
  }

  const parent = await db.collection("evaluations").doc(domain).get();
  const latestRunId = parent.exists ? (parent.data()?.latestRunId as string | undefined) : undefined;
  if (!latestRunId) {
    const svg = renderBadgeSvg({ domain, statusLabel: "Not evaluated" });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(404).send(svg);
  }

  const run = await db
    .collection("evaluations")
    .doc(domain)
    .collection("runs")
    .doc(latestRunId)
    .get();
  if (!run.exists) {
    const svg = renderBadgeSvg({ domain, statusLabel: "Not evaluated" });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(404).send(svg);
  }

  const data = run.data() as EvaluationResult;
  const updatedAt = data.completedAt ?? data.createdAt;
  const svg = renderBadgeSvg({
    domain,
    score: data.status === "complete" ? data.score : null,
    grade: data.status === "complete" ? data.grade : null,
    updatedAtISO: updatedAt,
  });
  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return res.status(data.status === "complete" ? 200 : 404).send(svg);
});

app.use((_req, res) => {
  return sendError(res, 404, "Not found", "not_found");
});

void getAgentabilityPublicStats().catch((error) => {
  logger.warn("Initial public stats prewarm failed", error);
});
void getPublicLeaderboard(CANONICAL_BASE_URL).catch((error) => {
  logger.warn("Initial leaderboard prewarm failed", error);
});

export const api = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    minInstances: 1,
  },
  app
);
