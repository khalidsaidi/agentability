import { describe, expect, it } from "vitest";
import { EvaluationInputSchema, EvaluationResultSchema } from "./index";

describe("evaluation schemas", () => {
  it("accepts workflow-aware evaluation input", () => {
    const parsed = EvaluationInputSchema.parse({
      origin: "https://example.com",
      profile: "auto",
      framework: "nextjs",
      targetWorkflows: ["Call API endpoint", "Read docs for setup"],
    });

    expect(parsed.framework).toBe("nextjs");
    expect(parsed.targetWorkflows).toHaveLength(2);
  });

  it("accepts enriched evaluation result fields", () => {
    const result = EvaluationResultSchema.parse({
      runId: "run-1",
      domain: "example.com",
      mode: "public",
      profile: "auto",
      input: {
        origin: "https://example.com",
        canonicalOrigin: "https://api.example.com",
        framework: "generic",
        targetWorkflows: ["Call API endpoint"],
      },
      status: "complete",
      score: 85,
      grade: "B",
      pillarScores: {
        discovery: 80,
        callableSurface: 90,
        llmIngestion: 80,
        trust: 85,
        reliability: 90,
      },
      checks: [],
      evidenceIndex: {
        entrypoints: [],
        callable: [],
        docs: [],
        attestations: [],
      },
      artifacts: {},
      siteType: "api_product",
      surfaceDiscovery: {
        rootOrigin: "https://example.com",
        selectedOrigin: "https://api.example.com",
        selectionReason: "OpenAPI present, docs endpoint reachable",
        candidates: [
          {
            origin: "https://example.com",
            category: "root",
            score: 20,
            selected: false,
            signals: { hasAir: false, hasOpenApi: false, hasDocs: true, hasMcp: false },
          },
          {
            origin: "https://api.example.com",
            category: "api",
            score: 80,
            selected: true,
            signals: { hasAir: true, hasOpenApi: true, hasDocs: true, hasMcp: true },
          },
        ],
      },
      scoreCalibration: {
        siteType: "api_product",
        profileUsed: "api_product",
        gradeBands: { a: 85, b: 70, c: 55 },
      },
      workflowAnalysis: {
        successRate: 0.5,
        readyCount: 0,
        partialCount: 1,
        blockedCount: 0,
        outcomes: [
          {
            workflow: "Call API endpoint",
            status: "partial",
            blockerCheckIds: [],
            warningCheckIds: ["C2"],
            estimatedImpact: 7,
          },
        ],
      },
      workflowProbes: {
        endpointDiscovery: true,
        schemaBackedCall: true,
        deterministicHandshake: true,
        docsDiscovery: true,
      },
      priorityFixes: [
        {
          checkId: "C2",
          status: "warn",
          blockedWorkflows: 1,
          estimatedScoreGain: 6,
          expectedScoreLift: 10,
          rationale: "Improves 1 target workflow.",
          exemplarDomains: ["openrouter.ai", "huggingface.co"],
        },
      ],
      fixPack: {
        framework: "generic",
        generatedAt: "2026-03-04T00:00:00.000Z",
        files: [
          {
            path: "public/.well-known/openapi.yaml",
            description: "OpenAPI surface",
            contents: "openapi: 3.1.0",
          },
        ],
      },
      engine: {
        version: "0.1.0",
        rulesetHash: "abc123",
        specVersion: "1.2",
      },
      createdAt: "2026-03-04T00:00:00.000Z",
      completedAt: "2026-03-04T00:00:05.000Z",
    });

    expect(result.workflowAnalysis?.outcomes[0]?.status).toBe("partial");
    expect(result.fixPack?.files[0]?.path).toBe("public/.well-known/openapi.yaml");
  });
});
