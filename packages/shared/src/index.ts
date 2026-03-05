import { z } from "zod";

export const EvaluationProfileSchema = z.enum([
  "auto",
  "api_product",
  "docs_platform",
  "content",
  "hybrid",
]);
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

export const EvaluationFrameworkSchema = z.enum([
  "generic",
  "nextjs",
  "fastapi",
  "rails",
  "express",
]);
export type EvaluationFramework = z.infer<typeof EvaluationFrameworkSchema>;

export const EvaluationInputSchema = z.object({
  origin: z.string().url(),
  profile: EvaluationProfileSchema.optional(),
  framework: EvaluationFrameworkSchema.optional(),
  targetWorkflows: z.array(z.string().min(3).max(140)).max(10).optional(),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export const CheckStatusSchema = z.enum(["pass", "warn", "fail"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckSeveritySchema = z.enum(["high", "medium", "low"]);
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>;

export const FailureModeSchema = z.enum(["missing", "malformed", "unstable"]);
export type FailureMode = z.infer<typeof FailureModeSchema>;

export const CheckResultSchema = z.object({
  id: z.string(),
  status: CheckStatusSchema,
  severity: CheckSeveritySchema,
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  failureMode: FailureModeSchema.optional(),
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

export const WorkflowStatusSchema = z.enum(["ready", "partial", "blocked"]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowOutcomeSchema = z.object({
  workflow: z.string(),
  status: WorkflowStatusSchema,
  blockerCheckIds: z.array(z.string()),
  warningCheckIds: z.array(z.string()),
  estimatedImpact: z.number(),
});
export type WorkflowOutcome = z.infer<typeof WorkflowOutcomeSchema>;

export const WorkflowAnalysisSchema = z.object({
  successRate: z.number(),
  readyCount: z.number(),
  partialCount: z.number(),
  blockedCount: z.number(),
  outcomes: z.array(WorkflowOutcomeSchema),
});
export type WorkflowAnalysis = z.infer<typeof WorkflowAnalysisSchema>;

export const WorkflowProbeSchema = z.object({
  endpointDiscovery: z.boolean(),
  schemaBackedCall: z.boolean(),
  deterministicHandshake: z.boolean(),
  docsDiscovery: z.boolean(),
});
export type WorkflowProbe = z.infer<typeof WorkflowProbeSchema>;

export const PriorityFixSchema = z.object({
  checkId: z.string(),
  status: CheckStatusSchema,
  blockedWorkflows: z.number(),
  estimatedScoreGain: z.number(),
  expectedScoreLift: z.number().optional(),
  rationale: z.string(),
  exemplarDomains: z.array(z.string()).optional(),
});
export type PriorityFix = z.infer<typeof PriorityFixSchema>;

export const SiteTypeSchema = z.enum(["marketing_site", "docs_portal", "api_product", "ai_native"]);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const SurfaceCategorySchema = z.enum(["root", "docs", "developers", "api", "other"]);
export type SurfaceCategory = z.infer<typeof SurfaceCategorySchema>;

export const SurfaceCandidateSchema = z.object({
  origin: z.string().url(),
  category: SurfaceCategorySchema,
  score: z.number(),
  selected: z.boolean().optional(),
  signals: z.object({
    hasAir: z.boolean(),
    hasOpenApi: z.boolean(),
    hasDocs: z.boolean(),
    hasMcp: z.boolean(),
  }),
});
export type SurfaceCandidate = z.infer<typeof SurfaceCandidateSchema>;

export const SurfaceDiscoverySchema = z.object({
  rootOrigin: z.string().url(),
  selectedOrigin: z.string().url(),
  selectionReason: z.string(),
  candidates: z.array(SurfaceCandidateSchema),
});
export type SurfaceDiscovery = z.infer<typeof SurfaceDiscoverySchema>;

export const ScoreCalibrationSchema = z.object({
  siteType: SiteTypeSchema,
  profileUsed: EvaluationProfileSchema,
  gradeBands: z.object({
    a: z.number(),
    b: z.number(),
    c: z.number(),
  }),
});
export type ScoreCalibration = z.infer<typeof ScoreCalibrationSchema>;

export const FixPackFileSchema = z.object({
  path: z.string(),
  description: z.string(),
  contents: z.string(),
});
export type FixPackFile = z.infer<typeof FixPackFileSchema>;

export const FixPackSchema = z.object({
  framework: EvaluationFrameworkSchema,
  generatedAt: z.string(),
  files: z.array(FixPackFileSchema),
});
export type FixPack = z.infer<typeof FixPackSchema>;

export const EvaluationResultSchema = z.object({
  runId: z.string(),
  domain: z.string(),
  mode: z.literal("public"),
  profile: EvaluationProfileSchema,
  input: z.object({
    origin: z.string().url(),
    canonicalOrigin: z.string().url().optional(),
    framework: EvaluationFrameworkSchema.optional(),
    targetWorkflows: z.array(z.string()).optional(),
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
  siteType: SiteTypeSchema.optional(),
  surfaceDiscovery: SurfaceDiscoverySchema.optional(),
  scoreCalibration: ScoreCalibrationSchema.optional(),
  previousRunId: z.string().optional(),
  diffSummary: DiffSummarySchema.optional(),
  workflowAnalysis: WorkflowAnalysisSchema.optional(),
  workflowProbes: WorkflowProbeSchema.optional(),
  priorityFixes: z.array(PriorityFixSchema).optional(),
  fixPack: FixPackSchema.optional(),
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
export * from "./recommendations";
export * from "./communityFix";
