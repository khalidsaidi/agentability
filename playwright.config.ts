import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "https://agentability.org",
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  retries: 1,
});
