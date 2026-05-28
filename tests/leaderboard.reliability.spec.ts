import { expect, test } from "@playwright/test";

const REQUIRED_DOMAINS = [
  "aistatusdashboard.com",
  "agentability.org",
  "a2abench-api.web.app",
  "ragmap-api.web.app",
  "rootfetch.com",
  "relayorb.com",
];

test("leaderboard.json is fresh and includes portfolio domains", async ({ request }) => {
  const response = await request.get(`/leaderboard.json?cb=${Date.now()}`, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    timeout: 20000,
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("application/json");

  const payload = (await response.json()) as {
    updatedAt?: string;
    entries?: Array<{ domain?: string }>;
  };

  expect(typeof payload.updatedAt).toBe("string");
  const updatedAtEpoch = Date.parse(payload.updatedAt ?? "");
  expect(Number.isFinite(updatedAtEpoch)).toBeTruthy();
  expect(Date.now() - updatedAtEpoch).toBeLessThan(24 * 60 * 60 * 1000);

  const domains = new Set((payload.entries ?? []).map((entry) => (entry.domain ?? "").toLowerCase()));
  for (const domain of REQUIRED_DOMAINS) {
    expect(domains.has(domain)).toBeTruthy();
  }
});
