import assert from "node:assert/strict";
import test from "node:test";
import {
  createJskitPlaywrightConfig,
  DEFAULT_LOCAL_BASE_URL
} from "../src/test/playwright.js";

test("Playwright config uses a self-started local app by default", () => {
  const config = createJskitPlaywrightConfig({ env: {} });

  assert.equal(config.use.baseURL, DEFAULT_LOCAL_BASE_URL);
  assert.equal(config.use.storageState, undefined);
  assert.deepEqual(config.webServer, {
    command: "npm run build && node ./bin/server.js",
    env: {
      PORT: "4173"
    },
    url: `${DEFAULT_LOCAL_BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000
  });
});

test("Playwright config uses a managed base URL without starting another server", () => {
  const config = createJskitPlaywrightConfig({
    env: {
      PLAYWRIGHT_BASE_URL: "https://preview.example.test/",
      JSKIT_PLAYWRIGHT_STORAGE_STATE: "/run/jskit/auth-state.json"
    }
  });

  assert.equal(config.use.baseURL, "https://preview.example.test");
  assert.equal(config.use.storageState, "/run/jskit/auth-state.json");
  assert.equal(config.webServer, undefined);
});
