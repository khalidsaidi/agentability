import { z } from "zod";

export const EvaluationProfileSchema = z.enum([
  "auto",
  "api_product",
  "docs_platform",
  "content",
  "hybrid",
]);
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

export const EvaluationInputSchema = z.object({
  origin: z.string().url(),
  profile: EvaluationProfileSchema.optional(),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export const CheckStatusSchema = z.enum(["pass", "warn", "fail"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckSeveritySchema = z.enum(["high", "medium", "low"]);
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>;

export const CheckResultSchema = z.object({
  id: z.string(),
  status: CheckStatusSchema,
  severity: CheckSeveritySchema,
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  recommendationId: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const DiffIssueSchema = z.object({
  checkId: z.string(),
  from: CheckStatusSchema.nullable(),
  to: CheckStatusSchema,
  severity: CheckSeveritySchema,
});
export type DiffIssue = z.infer<typeof DiffIssueSchema>;

export const DiffChangeSchema = z.object({
  checkId: z.string(),
  from: CheckStatusSchema.nullable(),
  to: CheckStatusSchema,
});
export type DiffChange = z.infer<typeof DiffChangeSchema>;

export const EvidenceRecordSchema = z.object({
  url: z.string().url(),
  method: z.string(),
  status: z.number(),
  headers: z.record(z.string()).optional(),
  contentType: z.string().optional(),
  contentLength: z.number().optional(),
  sha256: z.string().optional(),
  fetchedAt: z.string(),
  redirectChain: z
    .array(
      z.object({
        url: z.string().url(),
        status: z.number(),
      })
    )
    .optional(),
  error: z.string().optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const PillarScoresSchema = z.object({
  discovery: z.number(),
  callableSurface: z.number(),
  llmIngestion: z.number(),
  trust: z.number(),
  reliability: z.number(),
});
export type PillarScores = z.infer<typeof PillarScoresSchema>;

export const DiffSummarySchema = z.object({
  scoreDelta: z.number(),
  gradeFrom: z.string().optional(),
  gradeTo: z.string().optional(),
  pillarDelta: PillarScoresSchema,
  newIssues: z.array(DiffIssueSchema),
  fixedIssues: z.array(DiffIssueSchema),
  changed: z.array(DiffChangeSchema),
  counts: z.object({
    pass: z.number(),
    warn: z.number(),
    fail: z.number(),
  }),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const EvaluationResultSchema = z.object({
  runId: z.string(),
  domain: z.string(),
  mode: z.literal("public"),
  profile: EvaluationProfileSchema,
  input: z.object({
    origin: z.string().url(),
  }),
  status: z.enum(["complete", "running", "failed"]),
  score: z.number(),
  grade: z.string(),
  pillarScores: PillarScoresSchema,
  checks: z.array(CheckResultSchema),
  evidenceIndex: z.object({
    entrypoints: z.array(z.string()),
    callable: z.array(z.string()),
    docs: z.array(z.string()),
    attestations: z.array(z.string()),
  }),
  artifacts: z.object({
    jsonUrl: z.string().optional(),
    reportUrl: z.string().optional(),
    evidenceBundleUrl: z.string().optional(),
  }),
  previousRunId: z.string().optional(),
  diffSummary: DiffSummarySchema.optional(),
  engine: z.object({
    version: z.string(),
    rulesetHash: z.string(),
    specVersion: z.string().optional(),
  }),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export type EvaluationMode = "public";

export * from "./diff";
