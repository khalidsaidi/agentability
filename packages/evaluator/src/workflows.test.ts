import { describe, expect, it } from "vitest";
import type { CheckResult } from "@agentability/shared";
import {
  DEFAULT_TARGET_WORKFLOWS,
  SITE_DEFAULT_WORKFLOWS,
  analyzeWorkflows,
  inferRequiredChecks,
  normalizeTargetWorkflows,
  rankPriorityFixes,
} from "./workflows";

const baseChecks: CheckResult[] = [
  { id: "D1", status: "pass", severity: "high", summary: "", evidence: [] },
  { id: "T1", status: "pass", severity: "high", summary: "", evidence: [] },
  { id: "C2", status: "pass", severity: "high", summary: "", evidence: [] },
  { id: "C3", status: "pass", severity: "high", summary: "", evidence: [] },
  { id: "L1", status: "pass", severity: "high", summary: "", evidence: [] },
  { id: "R3", status: "pass", severity: "high", summary: "", evidence: [] },
];

describe("workflows", () => {
  it("uses default workflows when input is empty", () => {
    expect(normalizeTargetWorkflows()).toEqual([...DEFAULT_TARGET_WORKFLOWS]);
    expect(normalizeTargetWorkflows(["   ", ""])).toEqual([...DEFAULT_TARGET_WORKFLOWS]);
  });

  it("uses site-aware default workflows when site type is provided", () => {
    expect(normalizeTargetWorkflows(undefined, "marketing_site")).toEqual([
      ...SITE_DEFAULT_WORKFLOWS.marketing_site,
    ]);
    expect(normalizeTargetWorkflows(undefined, "docs_portal")).toEqual([
      ...SITE_DEFAULT_WORKFLOWS.docs_portal,
    ]);
  });

  it("docs portal defaults do not require API checks by default", () => {
    const workflows = normalizeTargetWorkflows(undefined, "docs_portal");
    const required = workflows.flatMap((workflow) => inferRequiredChecks(workflow, "docs_portal"));
    expect(required).not.toContain("C2");
    expect(required).toContain("L1");
  });

  it("infers check requirements from workflow intent", () => {
    const docs = inferRequiredChecks("search docs and answer questions");
    const api = inferRequiredChecks("run api automation");
    expect(docs).toContain("L1");
    expect(docs).not.toContain("C2");
    expect(api).toContain("C2");
    expect(api).toContain("C3");
    expect(api).toContain("R3");
  });

  it("computes workflow status and success rate", () => {
    const checks: CheckResult[] = baseChecks.map((item) => ({ ...item }));
    checks.find((check) => check.id === "C2")!.status = "fail";
    checks.find((check) => check.id === "L1")!.status = "warn";

    const analysis = analyzeWorkflows(
      ["Call a public API endpoint", "Search docs for setup help"],
      checks
    );
    expect(analysis.blockedCount).toBe(1);
    expect(analysis.partialCount).toBe(1);
    expect(analysis.readyCount).toBe(0);
    expect(analysis.successRate).toBe(0.25);
  });

  it("uses read-only probe signals to reduce false blocker states", () => {
    const checks: CheckResult[] = baseChecks.map((item) => ({ ...item }));
    checks.find((check) => check.id === "C2")!.status = "fail";
    checks.find((check) => check.id === "C3")!.status = "fail";

    const analysis = analyzeWorkflows(
      ["Call a public API endpoint"],
      checks,
      {
        endpointDiscovery: true,
        schemaBackedCall: true,
        deterministicHandshake: true,
        docsDiscovery: false,
      }
    );
    expect(analysis.blockedCount).toBe(0);
    expect(analysis.partialCount).toBe(1);
  });

  it("does not force API blockers for marketing defaults", () => {
    const checks: CheckResult[] = baseChecks.map((item) => ({ ...item }));
    checks.find((check) => check.id === "C2")!.status = "fail";
    checks.find((check) => check.id === "C3")!.status = "fail";

    const analysis = analyzeWorkflows(undefined, checks, { docsDiscovery: true, endpointDiscovery: false, schemaBackedCall: false, deterministicHandshake: false }, "marketing_site");
    expect(analysis.blockedCount).toBe(0);
    expect(analysis.readyCount).toBeGreaterThan(0);
  });

  it("downgrades D1 fail when docs are discoverable", () => {
    const checks: CheckResult[] = baseChecks.map((item) => ({ ...item }));
    checks.find((check) => check.id === "D1")!.status = "fail";

    const analysis = analyzeWorkflows(
      ["Find support and legal policies"],
      checks,
      {
        endpointDiscovery: false,
        schemaBackedCall: false,
        deterministicHandshake: false,
        docsDiscovery: true,
      },
      "marketing_site"
    );
    expect(analysis.blockedCount).toBe(0);
    expect(analysis.partialCount).toBe(1);
  });

  it("prioritizes fixes by workflow impact", () => {
    const checks: CheckResult[] = baseChecks.map((item) => ({ ...item }));
    checks.find((check) => check.id === "C2")!.status = "fail";
    checks.find((check) => check.id === "L1")!.status = "warn";
    const analysis = analyzeWorkflows(
      ["Call API", "Call API from automation", "Read docs"],
      checks
    );

    const ranked = rankPriorityFixes(checks, analysis);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.checkId).toBe("C2");
    expect(ranked[0]?.blockedWorkflows).toBeGreaterThanOrEqual(2);
  });
});
