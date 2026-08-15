import { defineConfig } from "@playwright/test";

const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "")
  .trim()
  .replace(/\/+$/u, "");
const baseURL = managedBaseUrl || "http://127.0.0.1:4173";
const storageState = String(process.env.VIBE64_PLAYWRIGHT_STORAGE_STATE || "").trim();

export default defineConfig({
  testDir: "./tests/e2e",
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
      command: "npm run build && node ./bin/server.js",
      env: {
        PORT: "4173"
      },
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000
    }
  })
});
