import { defineConfig } from "@playwright/test";

/*
  End-to-end tests run against a real service and a running web app; nothing is started or
  mocked here. See e2e/demo.spec.ts for the prerequisites.
*/
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
});
