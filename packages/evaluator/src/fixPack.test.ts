import { describe, expect, it } from "vitest";
import type { CheckResult } from "@agentability/shared";
import { buildFixPack } from "./fixPack";

function check(id: string, status: CheckResult["status"]): CheckResult {
  return {
    id,
    status,
    severity: "high",
    summary: "",
    evidence: [],
  };
}

describe("fix pack", () => {
  it("generates framework-specific files for non-pass checks", () => {
    const fixPack = buildFixPack({
      framework: "nextjs",
      domain: "example.com",
      targetWorkflows: ["Call API", "Read docs"],
      checks: [
        check("D1", "fail"),
        check("C2", "fail"),
        check("C3", "fail"),
        check("L1", "warn"),
      ],
    });

    const paths = fixPack.files.map((item) => item.path);
    expect(paths).toContain("public/.well-known/air.json");
    expect(paths).toContain("public/.well-known/openapi.yaml");
    expect(paths).toContain("public/docs.md");
    expect(paths).toContain("app/api/mcp/route.ts");
  });

  it("returns a maintenance checklist when no fixes are required", () => {
    const fixPack = buildFixPack({
      framework: "generic",
      domain: "example.com",
      targetWorkflows: ["Call API"],
      checks: [check("D1", "pass"), check("C2", "pass"), check("L1", "pass")],
    });

    expect(fixPack.files).toHaveLength(1);
    expect(fixPack.files[0]?.path).toBe("docs/agentability-maintenance.md");
  });
});
