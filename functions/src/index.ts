// Server side of agentability.org: the public instant check, and the hard stop
// on spend. Everything else on the site is static files.

import { onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";
import { evaluateSite, configureFetch } from "../../scripts/lib/evaluate-site";
import { guardedFetch, normalizeDomain, requestContext } from "./guard";

initializeApp();
const db = getFirestore();
configureFetch(guardedFetch);

const PROJECT = "agentability-prod-jenfjn";
const REGION = "us-central1";
const SITE_ORIGIN = "https://agentability.org";

// Limits. One check makes roughly ten requests to the site being checked, so
// these also stop anyone using this endpoint to hammer a third party.
const PER_IP_PER_HOUR = 10;
const GLOBAL_PER_DAY = 1000;
const CACHE_HOURS = 24;
const CHECK_TIMEOUT_MS = 45_000;
// Firestore deletes counters and cached results after this (TTL on expiresAt).
const KEEP_DAYS = 2;

type Reply = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

function clientIp(xff: string | undefined, fallback: string | undefined): string {
  // Firebase Hosting puts the visitor's address first.
  return (xff?.split(",")[0] || fallback || "unknown").trim();
}

// Hashed with a daily salt: enough to count requests, not enough to keep a list
// of who checked what.
function ipKey(ip: string, day: string): string {
  return createHash("sha256").update(`agentability-check|${day}|${ip}`).digest("hex").slice(0, 32);
}

async function takeSlot(ip: string): Promise<Reply | null> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const expiresAt = Timestamp.fromMillis(now.getTime() + KEEP_DAYS * 86_400_000);
  const ipRef = db.collection("checkLimits").doc(`ip_${ipKey(ip, day)}_${hour}`);
  const dayRef = db.collection("checkLimits").doc(`day_${day}`);
  return db.runTransaction(async (tx) => {
    const [ipDoc, dayDoc] = await Promise.all([tx.get(ipRef), tx.get(dayRef)]);
    const ipCount = (ipDoc.get("count") as number) ?? 0;
    const dayCount = (dayDoc.get("count") as number) ?? 0;
    if (ipCount >= PER_IP_PER_HOUR) {
      const retry = 3600 - (now.getMinutes() * 60 + now.getSeconds());
      return { status: 429, headers: { "Retry-After": String(retry) }, body: { error: "rate_limited", message: `That's ${PER_IP_PER_HOUR} checks this hour. Try again in about ${Math.ceil(retry / 60)} minutes.` } };
    }
    if (dayCount >= GLOBAL_PER_DAY) {
      return { status: 429, body: { error: "daily_cap", message: "Today's free checks are used up. Try again tomorrow, or ask us to add the site to the Index." } };
    }
    tx.set(ipRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
    tx.set(dayRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
    return null;
  });
}

function publicShape(r: Awaited<ReturnType<typeof evaluateSite>>) {
  return {
    domain: r.domain,
    checkedAt: r.checkedAt,
    score: r.score,
    grade: r.grade,
    posture: r.posture,
    paradox: r.paradox,
    robotsReadable: r.robotsReadable ?? null,
    checks: (r.checks ?? []).map((c) => ({ id: c.id, title: c.title, status: c.status, points: c.points, maxPoints: c.maxPoints, detail: c.detail })),
  };
}

async function handle(method: string, origin: string | undefined, rawDomain: unknown, ip: string): Promise<Reply> {
  if (method !== "POST") return { status: 405, headers: { Allow: "POST" }, body: { error: "method_not_allowed" } };
  // Other websites may not put this checker in their own pages and spend its
  // budget. Requests without an Origin (scripts, curl) are still rate limited.
  if (origin && origin !== SITE_ORIGIN) return { status: 403, body: { error: "origin_not_allowed" } };

  const config = await db.collection("config").doc("check").get();
  if (config.get("disabled") === true) {
    return { status: 503, body: { error: "paused", message: "Instant checks are paused. You can still ask us to add a site to the Index." } };
  }

  const domain = normalizeDomain(rawDomain);
  if (!domain) return { status: 400, body: { error: "invalid_domain", message: "That doesn't look like a public website address. Try something like example.com." } };

  const limited = await takeSlot(ip);
  if (limited) return limited;

  const cacheRef = db.collection("checkCache").doc(domain);
  const cached = await cacheRef.get();
  const cachedAt = cached.get("at") as Timestamp | undefined;
  if (cached.exists && cachedAt && Date.now() - cachedAt.toMillis() < CACHE_HOURS * 3_600_000) {
    return { status: 200, body: { ...(cached.get("result") as object), cached: true } };
  }

  const ctx: { blocked?: string } = {};
  const result = await requestContext.run(ctx, () =>
    Promise.race([
      evaluateSite(domain),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), CHECK_TIMEOUT_MS)),
    ])
  );
  if (ctx.blocked) {
    logger.warn("check blocked", { domain, reason: ctx.blocked });
    return { status: 422, body: { error: "not_public", message: "That address points somewhere private, not to a public website, so we won't check it." } };
  }
  if (result === "timeout") return { status: 504, body: { error: "timeout", message: `${domain} took too long to answer. An agent would have given up too.` } };
  if (result.status !== "complete") {
    return { status: 502, body: { error: "unreachable", domain, reason: result.failure ?? null, message: `We couldn't reach ${domain}. If it's up in your browser, it may be refusing automated visitors altogether.` } };
  }
  const shaped = publicShape(result);
  await cacheRef.set({ at: Timestamp.now(), result: shaped, expiresAt: Timestamp.fromMillis(Date.now() + KEEP_DAYS * 86_400_000) });
  return { status: 200, body: { ...shaped, cached: false } };
}

export const check = onRequest(
  {
    region: REGION,
    // A few small instances: enough for real use, and a ceiling on cost.
    maxInstances: 3,
    concurrency: 10,
    memory: "512MiB",
    timeoutSeconds: 60,
    serviceAccount: `site-check@${PROJECT}.iam.gserviceaccount.com`,
    invoker: "public",
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      const ip = clientIp(req.get("x-forwarded-for"), req.ip);
      const body = typeof req.body === "object" && req.body ? (req.body as Record<string, unknown>) : {};
      const reply = await handle(req.method, req.get("origin"), body.domain, ip);
      for (const [k, v] of Object.entries(reply.headers ?? {})) res.set(k, v);
      res.status(reply.status).json(reply.body);
    } catch (error) {
      logger.error("check failed", error as Error);
      res.status(500).json({ error: "internal", message: "Something went wrong on our side. Try again in a minute." });
    }
  }
);

// The hard stop. A Cloud Billing budget (CAD 50 a month, this project only)
// publishes its running cost to the billing-cap topic. When the cost reaches the
// budget, this pauses the instant check and then detaches billing from the
// project, which stops every paid service in it. The static site keeps working:
// Firebase Hosting runs on the free tier, as it did before billing was enabled.
// A message with attribute dryRun=true only checks that the permission is there.
export const billingCap = onMessagePublished(
  { topic: "billing-cap", region: REGION, serviceAccount: `billing-cap@${PROJECT}.iam.gserviceaccount.com`, maxInstances: 1 },
  async (event) => {
    const data = (event.data.message.json ?? {}) as { costAmount?: number; budgetAmount?: number; currencyCode?: string };
    const dryRun = event.data.message.attributes?.dryRun === "true";
    const cost = Number(data.costAmount ?? 0);
    const budget = Number(data.budgetAmount ?? 0);
    logger.info("budget notification", { cost, budget, currency: data.currencyCode, dryRun });
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();

    if (dryRun) {
      const r = await client.request<{ permissions?: string[] }>({
        url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`,
        method: "POST",
        data: { permissions: ["resourcemanager.projects.deleteBillingAssignment"] },
      });
      logger.info("dry run: permission to detach billing", { granted: r.data.permissions ?? [] });
      return;
    }
    if (!(budget > 0) || cost < budget) return;

    await db.collection("config").doc("check").set({ disabled: true, reason: `spend ${cost} reached budget ${budget}`, at: Timestamp.now() }, { merge: true });
    const info = await client.request<{ billingEnabled?: boolean }>({ url: `https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo` });
    if (!info.data.billingEnabled) {
      logger.info("billing already detached");
      return;
    }
    await client.request({
      url: `https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`,
      method: "PUT",
      data: { billingAccountName: "" },
    });
    logger.warn("budget reached: billing detached from the project", { cost, budget });
  }
);
