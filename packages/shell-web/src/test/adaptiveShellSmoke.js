const DEFAULT_SMOKE_PATH = String(process.env.JSKIT_PLAYWRIGHT_SMOKE_PATH || "/home");
const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "compact", width: 390, height: 844 }),
  Object.freeze({ name: "medium", width: 768, height: 1024 }),
  Object.freeze({ name: "expanded", width: 1280, height: 900 })
]);

async function expectNoHorizontalOverflow(page, expect) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectGeneratedScreenContract(page, expect) {
  const screen = page.locator(".generated-ui-screen").first();

  await expect(screen).toBeVisible();
}

async function pullToRefresh(page, expect) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.dispatchEvent("body", "pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 180,
    clientY: 90
  });
  await page.dispatchEvent("body", "pointermove", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 184,
    clientY: 250
  });
  await expect(page.getByTestId("jskit-shell-pull-refresh")).toBeVisible();
  await page.dispatchEvent("body", "pointerup", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 184,
    clientY: 250
  });
}

async function isElementVisibleInViewport(page, testId) {
  return page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    );
  });
}

async function runAdaptiveShellSmokeCase({
  page,
  expect,
  smokePath = DEFAULT_SMOKE_PATH,
  viewport
} = {}) {
  if (!page || !expect || !viewport) {
    throw new Error("runAdaptiveShellSmokeCase requires page, expect, and viewport.");
  }

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(smokePath);
  await expect(page.locator("body")).toBeVisible();
  await expectGeneratedScreenContract(page, expect);
  await expectNoHorizontalOverflow(page, expect);

  if (viewport.name === "compact") {
    let bootstrapRequests = 0;
    await page.route("**/api/bootstrap**", async (route) => {
      bootstrapRequests += 1;
      await route.continue();
    });
    const bootstrapRequestsBeforePull = bootstrapRequests;

    await expect(page.getByTestId("jskit-shell-bottom-nav")).toBeVisible();
    expect(await isElementVisibleInViewport(page, "jskit-shell-drawer")).toBe(false);

    const navButtonHeights = await page.getByTestId("jskit-shell-bottom-nav").locator(".v-btn").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(navButtonHeights.length).toBeGreaterThan(0);
    for (const height of navButtonHeights) {
      expect(height).toBeGreaterThanOrEqual(48);
    }

    await pullToRefresh(page, expect);
    await expect.poll(() => bootstrapRequests).toBeGreaterThan(bootstrapRequestsBeforePull);
  } else {
    await expect(page.getByTestId("jskit-shell-drawer")).toBeVisible();
  }
}

function runAdaptiveShellSmoke({
  test,
  expect,
  smokePath = DEFAULT_SMOKE_PATH,
  viewports = DEFAULT_VIEWPORTS
} = {}) {
  if (!test || !expect) {
    throw new Error("runAdaptiveShellSmoke requires Playwright test and expect.");
  }

  test.describe("generated adaptive shell smoke", () => {
    for (const viewport of viewports) {
      test(`${viewport.name} layout has reachable navigation and no horizontal overflow`, async ({ page }) => {
        await runAdaptiveShellSmokeCase({ page, expect, smokePath, viewport });
      });
    }
  });
}

export { DEFAULT_VIEWPORTS, runAdaptiveShellSmoke, runAdaptiveShellSmokeCase };
