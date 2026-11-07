import { defineConfig } from "@playwright/test";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "")
  .trim()
  .replace(/\/+$/u, "");
const port = String(process.env.PLAYWRIGHT_PORT || "").trim() || "4173";
const baseURL = managedBaseUrl || `http://127.0.0.1:${port}`;
const storageState = String(process.env.PLAYWRIGHT_STORAGE_STATE || "").trim();

export default defineConfig({
  testDir: "./tests/e2e",
  // Spec files run in parallel within the machine's test budget, so each one works on its own data.
  workers: testConcurrency(),
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    headless: true,
    ...(storageState ? { storageState } : {})
  },
  ...(managedBaseUrl ? {} : {
    webServer: {
      command: "npm run develop",
      env: {
        PORT: port
      },
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000
    }
  })
});
