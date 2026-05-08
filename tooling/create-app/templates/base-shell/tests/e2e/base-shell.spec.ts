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

async function expectGeneratedScreenContract(page) {
  const screen = page.locator(".generated-ui-screen").first();

  await expect(screen).toBeVisible();
  await expect(screen).toHaveClass(/generated-ui-screen--app/u);
  await expect(screen.locator("h1").first()).toBeVisible();
}

test.describe("generated base app responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} home route renders without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${SMOKE_PATH}`);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.getByText("Home base")).toBeVisible();
      await expectGeneratedScreenContract(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});
