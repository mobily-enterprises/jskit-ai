import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1280]) {
  test(`startup remains visible before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseScripts!: () => void;
    const scriptsHeld = new Promise<void>(resolve => { releaseScripts = resolve; });
    let scriptRequests = 0;
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") {
        scriptRequests += 1;
        await scriptsHeld;
      }
      await route.continue();
    });
    try {
      await page.goto("/home", { waitUntil: "commit" });
      await expect(page.getByRole("status")).toHaveText("Loading application…");
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
      await expect.poll(() => scriptRequests).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        reloadHeight: document.querySelector("#startup-shell a")!.getBoundingClientRect().height
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.reloadHeight).toBeGreaterThanOrEqual(48);
    } finally {
      releaseScripts();
    }
    await expect(page.locator("#app[data-v-app]")).toBeVisible();
    await expect(page.locator("#startup-shell")).toHaveCount(0);
  });
}
