import crypto from "crypto";
import cors from "cors";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { evaluatePublic } from "@agentability/evaluator";
import { EvaluationInputSchema, EvaluationResult } from "@agentability/shared";

initializeApp();

const db = getFirestore();
const storage = getStorage();

const app = express();
app.use(express.json({ limit: "1mb" }));

const allowedPostOrigins = new Set([
  "https://agentability.org",
  "https://www.agentability.org",
  "http://localhost:5173",
  "http://localhost:3000",
]);

const corsHandler = cors((req, callback) => {
  const origin = req.headers.origin;
  if (req.method === "GET") {
    return callback(null, { origin: true });
  }
  if (origin && allowedPostOrigins.has(origin)) {
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
  return `${proto}://${req.get("host")}`;
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

async function uploadEvidenceBundle(
  domain: string,
  runId: string,
  evidence: unknown[]
): Promise<{ evidenceBundleUrl?: string; storagePath?: string }> {
  const bucket = storage.bucket();
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
  const ip = getRequestIp(req);
  try {
    await enforceRateLimit(ip);
  } catch (error) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  const payload = req.body ?? {};
  const rawOrigin = typeof payload.origin === "string" ? payload.origin : "";
  const coerced = { ...payload, origin: coerceOrigin(rawOrigin) };
  const parseResult = EvaluationInputSchema.safeParse(coerced);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid request", details: parseResult.error });
  }

  const runId = crypto.randomUUID();
  const { origin, domain } = normalizeOrigin(parseResult.data.origin);
  const baseUrl = buildBaseUrl(req);

  let evaluation: EvaluationResult | null = null;

  try {
    const runRef = db
      .collection("evaluations")
      .doc(domain)
      .collection("runs")
      .doc(runId);

    await runRef.set({
      runId,
      domain,
      mode: "public",
      status: "running",
      input: { origin },
      createdAt: new Date().toISOString(),
    });

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
        });

      return res.json({
        runId,
        status: "running",
        jsonUrl,
        reportUrl,
        statusUrl,
        domain,
      });
    }

    const { result, evidence } = outcome;
    const finalUrls = await finalizeEvaluation(result, evidence);
    const statusUrl = `${baseUrl}/v1/runs/${runId}`;
    return res.json({
      runId,
      status: "complete",
      jsonUrl: finalUrls.jsonUrl,
      reportUrl: finalUrls.reportUrl,
      statusUrl,
      domain: result.domain,
    });
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
    return res.status(500).json({ error: "Evaluation failed" });
  }
});

app.get("/v1/runs/:runId", async (req, res) => {
  const runId = req.params.runId;
  const snap = await db
    .collectionGroup("runs")
    .where("runId", "==", runId)
    .limit(1)
    .get();

  if (snap.empty) {
    return res.status(404).json({ error: "Run not found" });
  }

  const doc = snap.docs[0];
  return res.json(doc.data());
});

app.get("/v1/evaluations/:domain/latest.json", async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const parent = await db.collection("evaluations").doc(domain).get();
  if (!parent.exists) {
    return res.status(404).json({ error: "Domain not found" });
  }
  const latestRunId = parent.data()?.latestRunId as string | undefined;
  if (!latestRunId) {
    return res.status(404).json({ error: "No evaluations yet" });
  }
  const run = await db
    .collection("evaluations")
    .doc(domain)
    .collection("runs")
    .doc(latestRunId)
    .get();
  if (!run.exists) {
    return res.status(404).json({ error: "Run not found" });
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
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(run.data());
});

export const api = onRequest(
  {
    region: "us-central1",
  },
  app
);
