import { describe, expect, it } from "vitest";
import type { CheckResult } from "./index";
import { computeDiff } from "./diff";

const baseChecks: CheckResult[] = [
  { id: "D1", status: "pass", severity: "high", summary: "ok", evidence: [] },
  { id: "L1", status: "pass", severity: "high", summary: "ok", evidence: [] },
];

const baseRun = {
  score: 80,
  grade: "B",
  pillarScores: {
    discovery: 16,
    callableSurface: 16,
    llmIngestion: 16,
    trust: 16,
    reliability: 16,
  },
  checks: baseChecks,
};

describe("computeDiff", () => {
  it("returns null when there is no previous run", () => {
    const result = computeDiff(null, baseRun);
    expect(result).toBeNull();
  });

  it("classifies regressions as new issues", () => {
    const previous = {
      ...baseRun,
      checks: [{ ...baseChecks[0], status: "pass" }, baseChecks[1]],
    };
    const current = {
      ...baseRun,
      checks: [{ ...baseChecks[0], status: "fail" }, baseChecks[1]],
    };
    const diff = computeDiff(previous, current);
    expect(diff?.newIssues).toHaveLength(1);
    expect(diff?.newIssues[0]).toMatchObject({ checkId: "D1", from: "pass", to: "fail" });
  });

  it("classifies improvements as fixed issues", () => {
    const previous = {
      ...baseRun,
      checks: [{ ...baseChecks[0], status: "fail" }, baseChecks[1]],
    };
    const current = {
      ...baseRun,
      checks: [{ ...baseChecks[0], status: "pass" }, baseChecks[1]],
    };
    const diff = computeDiff(previous, current);
    expect(diff?.fixedIssues).toHaveLength(1);
    expect(diff?.fixedIssues[0]).toMatchObject({ checkId: "D1", from: "fail", to: "pass" });
  });

  it("computes pillar deltas", () => {
    const previous = {
      ...baseRun,
      pillarScores: { ...baseRun.pillarScores, discovery: 10 },
    };
    const current = {
      ...baseRun,
      pillarScores: { ...baseRun.pillarScores, discovery: 14 },
    };
    const diff = computeDiff(previous, current);
    expect(diff?.pillarDelta.discovery).toBe(4);
  });
});
