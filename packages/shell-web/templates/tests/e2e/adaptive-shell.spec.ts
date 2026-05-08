import { expect, test } from "@playwright/test";

const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173").replace(/\/+$/u, "");
const SMOKE_PATH = String(process.env.JSKIT_PLAYWRIGHT_SMOKE_PATH || "/home");

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function isElementVisibleInViewport(page, testId: string) {
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

test.describe("generated adaptive shell smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} layout has reachable navigation and no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${SMOKE_PATH}`);
      await expect(page.locator("body")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      if (viewport.name === "compact") {
        await expect(page.getByTestId("jskit-shell-bottom-nav")).toBeVisible();
        expect(await isElementVisibleInViewport(page, "jskit-shell-drawer")).toBe(false);

        const navButtonHeights = await page.getByTestId("jskit-shell-bottom-nav").locator(".v-btn").evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().height)
        );
        expect(navButtonHeights.length).toBeGreaterThan(0);
        for (const height of navButtonHeights) {
          expect(height).toBeGreaterThanOrEqual(48);
        }
      } else {
        await expect(page.getByTestId("jskit-shell-drawer")).toBeVisible();
      }
    });
  }
});
