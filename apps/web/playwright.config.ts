import { defineConfig } from "@playwright/test"
import { settings } from "./e2e/settings.ts"

export default defineConfig({
  testDir: "./e2e",
  timeout: settings.timeoutMs * 3,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: settings.baseURL,
    channel: settings.browserChannel,
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15000,
  },
})
