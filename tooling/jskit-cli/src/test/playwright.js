const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_SMOKE_PATH = "/home";
const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "compact", width: 390, height: 844 }),
  Object.freeze({ name: "medium", width: 768, height: 1024 }),
  Object.freeze({ name: "expanded", width: 1280, height: 900 })
]);

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/u, "");
}

function createJskitPlaywrightConfig({ env = process.env } = {}) {
  const managedBaseUrl = normalizeBaseUrl(env.PLAYWRIGHT_BASE_URL);
  const baseURL = managedBaseUrl || DEFAULT_LOCAL_BASE_URL;
  const storageState = String(env.VIBE64_PLAYWRIGHT_STORAGE_STATE || "").trim();

  return {
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
  };
}

async function expectNoHorizontalOverflow(page, expect) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectVisibleTapTargets(page, expect) {
  const heights = await page.locator("a[href], button, [role='button'], .v-btn, .v-list-item").evaluateAll(
    (elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect().height)
  );

  for (const height of heights) {
    expect(height).toBeGreaterThanOrEqual(48);
  }
}

async function runGeneratedAppSmokeCase({
  page,
  expect,
  expectedText,
  viewport,
  smokePath = String(process.env.JSKIT_PLAYWRIGHT_SMOKE_PATH || DEFAULT_SMOKE_PATH)
} = {}) {
  if (!page || !expect || !String(expectedText || "").trim() || !viewport) {
    throw new Error("runGeneratedAppSmokeCase requires page, expect, expectedText, and viewport.");
  }

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(smokePath);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText(expectedText)).toBeVisible();
  await expect(page.locator(".generated-ui-screen").first()).toBeVisible();
  await expectVisibleTapTargets(page, expect);
  await expectNoHorizontalOverflow(page, expect);
}

function runGeneratedAppSmoke({ test, expect, expectedText } = {}) {
  if (!test || !expect || !String(expectedText || "").trim()) {
    throw new Error("runGeneratedAppSmoke requires Playwright test, expect, and expectedText.");
  }

  const smokePath = String(process.env.JSKIT_PLAYWRIGHT_SMOKE_PATH || DEFAULT_SMOKE_PATH);

  test.describe("generated app responsive smoke", () => {
    for (const viewport of DEFAULT_VIEWPORTS) {
      test(`${viewport.name} home route renders without horizontal overflow`, async ({ page }) => {
        await runGeneratedAppSmokeCase({ page, expect, expectedText, viewport, smokePath });
      });
    }
  });
}

export {
  createJskitPlaywrightConfig,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_VIEWPORTS,
  runGeneratedAppSmoke,
  runGeneratedAppSmokeCase
};
