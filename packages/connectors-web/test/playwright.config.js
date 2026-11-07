import { defineConfig } from "@playwright/test";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

const managedUrl = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: ".",
  testMatch: "configuration.spec.js",
  workers: testConcurrency(),
  use: {
    baseURL: managedUrl || "http://127.0.0.1:4187",
    storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined
  },
  webServer: managedUrl ? undefined : {
    command: "npm exec --no -- vite --config packages/connectors-web/test/vite.config.js",
    cwd: new URL("../../../", import.meta.url).pathname,
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false
  }
});
