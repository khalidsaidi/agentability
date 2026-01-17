import crypto from "crypto";
import dns from "node:dns/promises";
import net from "node:net";
import cors from "cors";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { evaluatePublic } from "@agentability/evaluator";
import { EvaluationInputSchema, EvaluationProfile, EvaluationResult } from "@agentability/shared";
import { SSR_ASSETS } from "./ssr/asset-manifest";

initializeApp();

const db = getFirestore();
const storage = getStorage();
const evidenceBucketName =
  process.env.EVIDENCE_BUCKET ||
  (process.env.GCLOUD_PROJECT ? `${process.env.GCLOUD_PROJECT}-evidence` : undefined);

const app = express();
app.use(express.json({ limit: "1mb" }));

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

function getRequestIp(req: express.Request): string {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || "unknown";
}

async function enforceRateLimit(ip: string): Promise<void> {
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 10;
  const windowId = Math.floor(Date.now() / windowMs);
  const docId = `${ip.replace(/[:.]/g, "_")}_${windowId}`;
  const ref = db.collection("rateLimits").doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()?.count as number) || 0 : 0;
    if (count >= maxRequests) {
      throw new Error("Rate limit exceeded");
    }
    tx.set(
      ref,
      {
        ip,
        count: count + 1,
        windowId,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + windowMs * 2).toISOString(),
      },
      { merge: true }
    );
  });
}

function buildBaseUrl(req: express.Request): string {
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

type PillarKey = "discovery" | "callableSurface" | "llmIngestion" | "trust" | "reliability";

const SITE_NAME = "Agentability";
const DEFAULT_DESCRIPTION =
  "Agentability audits public machine entrypoints, docs, and reliability to score agent readiness.";
const ROBOTS_INDEX =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

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
  L1: "Publish a public /docs page and link it from air.json.",
  L4: "Fix or remove broken docs links.",
  R3: "Remove random output (timestamps, IDs) from critical pages.",
  T1: "Publish a simple verification file and link it in air.json.",
  T2: "Sign the verification file or include clear ownership metadata.",
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
    "Host a public verification file and link it from air.json.",
    "Add contact and legal URLs in the ai-plugin file.",
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

function renderReportHtml(baseUrl: string, domain: string, report?: EvaluationResult): string {
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
      h1 { margin: 0 0 8px; font-size: 28px; }
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
        <h1>${escapeHtml(domain)}</h1>
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
  version: process.env.AGENTABILITY_VERSION || "0.1.0",
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
  const ip = getRequestIp(req);
  try {
    await enforceRateLimit(ip);
  } catch (error) {
    return { ok: false, status: 429, message: "Rate limit exceeded", code: "rate_limited" };
  }

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
    const runRef = db
      .collection("evaluations")
      .doc(domain)
      .collection("runs")
      .doc(runId);
    const runRootRef = db.collection("runs").doc(runId);

    const baseRun = {
      runId,
      domain,
      mode: "public",
      status: "running",
      input: { origin },
      createdAt: new Date().toISOString(),
    };

    await runRef.set(baseRun);
    await runRootRef.set(baseRun);

    const finalizeEvaluation = async (result: EvaluationResult, evidence: unknown[]) => {
      evaluation = { ...result, runId };
      const artifacts = {
        reportUrl: `${baseUrl}/reports/${result.domain}`,
        jsonUrl: `${baseUrl}/v1/evaluations/${result.domain}/latest.json`,
      } as EvaluationResult["artifacts"];

      const evidenceUpload = await uploadEvidenceBundle(result.domain, runId, evidence);
      if (evidenceUpload.evidenceBundleUrl) {
        artifacts.evidenceBundleUrl = evidenceUpload.evidenceBundleUrl;
      }

      evaluation = {
        ...evaluation,
        status: "complete",
        artifacts,
        completedAt: new Date().toISOString(),
      };

      await runRef.set(evaluation, { merge: true });
      await runRootRef.set(evaluation, { merge: true });

      await db.collection("evaluations").doc(result.domain).set(
        {
          domain: result.domain,
          latestRunId: runId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

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
    return { ok: false, status: 500, message: "Evaluation failed", code: "evaluation_failed" };
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

app.post("/v1/evaluate", async (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const outcome = await runEvaluation(req, payload);
  if (!outcome.ok) {
    return sendError(res, outcome.status, outcome.message, outcome.code, outcome.details);
  }
  return res.json(outcome.result);
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

app.get("/reports/:domain", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const baseUrl = buildBaseUrl(req);
  let report: EvaluationResult | undefined;

  try {
    const parent = await db.collection("evaluations").doc(domain).get();
    const latestRunId = parent.exists ? (parent.data()?.latestRunId as string | undefined) : undefined;
    if (latestRunId) {
      const run = await db
        .collection("evaluations")
        .doc(domain)
        .collection("runs")
        .doc(latestRunId)
        .get();
      if (run.exists) {
        report = run.data() as EvaluationResult;
      }
    }
  } catch (error) {
    logger.warn("Report SSR failed", error);
  }

  const html = renderReportHtml(baseUrl, domain, report);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.status(report ? 200 : 404).send(html);
});

app.get("/v1/runs/:runId", async (req, res) => {
  const runId = req.params.runId;
  const doc = await db.collection("runs").doc(runId).get();
  if (!doc.exists) {
    return sendError(res, 404, "Run not found", "not_found");
  }
  return res.json(doc.data());
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
  return res.json(run.data());
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

export const api = onRequest(
  {
    region: "us-central1",
    invoker: "public",
  },
  app
);
