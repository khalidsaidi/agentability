import { test, expect } from "@playwright/test";

const DOMAIN = "aistatusdashboard.com";

test.describe("Agentability e2e", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("agentability.tour.v1", "seen");
    });
    page.on("pageerror", (error) => {
      // eslint-disable-next-line no-console
      console.error("PAGEERROR:", error.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        // eslint-disable-next-line no-console
        console.error("CONSOLE:", msg.text());
      }
    });
  });

  test("landing renders and shows proof panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Make your site instantly usable/i })).toBeVisible();
    await expect(page.getByText(/Verification proof/i)).toBeVisible();
    await expect(page.getByText(/How it works/i)).toBeVisible();
  });

  test("run audit flow to report", async ({ page }) => {
    await page.goto("/");

    const input = page.getByPlaceholder("example.com");
    await input.fill(DOMAIN);
    await page.getByRole("button", { name: /Run Audit/i }).click();

    await expect(page).toHaveURL(/\/runs\//, { timeout: 20000 });

    await page.goto(`/reports/${DOMAIN}`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/reports/${DOMAIN}`));
    await expect(page.getByText(/What an AI agent sees/i)).toBeVisible();
    await expect(page.getByText(/Share on X/i)).toBeVisible();
    await expect(page.getByText(/Better than/i)).toBeVisible();
  });
});
