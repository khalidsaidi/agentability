import { describe, expect, it } from "vitest";
import { buildA2ABenchSearchUrl, buildCommunityFixQuery, normalizeCommunityFixResponse } from "./communityFix";
import { getFixIt } from "./recommendations";

describe("buildCommunityFixQuery", () => {
  it("builds a deterministic query with key terms", () => {
    const recommendation = getFixIt("D1");
    const query = buildCommunityFixQuery({
      issueId: "D1",
      summary: "Missing air.json",
      recommendation,
    });
    expect(query).toContain("Agentability D1");
    expect(query).toContain("Missing air.json");
    expect(query).toMatch(/air\.json/);
  });

  it("handles missing recommendations", () => {
    const query = buildCommunityFixQuery({ issueId: "T2", summary: "Missing ai-plugin.json" });
    expect(query).toBe("Agentability T2 Missing ai-plugin.json fix");
  });
});

describe("normalizeCommunityFixResponse", () => {
  it("normalizes citations from mixed shapes", () => {
    const normalized = normalizeCommunityFixResponse({
      answerMd: "Plan",
      citations: ["https://example.com", { url: "https://example.org", title: "Example" }, { link: "https://x.io" }],
    });
    expect(normalized.answerMd).toBe("Plan");
    expect(normalized.citations).toHaveLength(3);
    expect(normalized.citations[1]).toMatchObject({ url: "https://example.org", title: "Example" });
  });
});

describe("buildA2ABenchSearchUrl", () => {
  it("builds a stable search URL", () => {
    const url = buildA2ABenchSearchUrl("https://a2abench-api.web.app/", "test query");
    expect(url).toBe("https://a2abench-api.web.app/search?q=test%20query");
  });
});
