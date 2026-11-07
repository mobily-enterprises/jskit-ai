import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_ROOT = fileURLToPath(new URL(".", import.meta.url));
const SKIP = process.env.JSKIT_CONNECTORS_WEB_BROWSER === "1" ? false : "set JSKIT_CONNECTORS_WEB_BROWSER=1";
const VIEWPORTS = Object.freeze([{ width: 390, height: 1000 }, { width: 1280, height: 1000 }]);

// Opens the Redshift form's AWS Region select and, while its menu still scales in, types "o" then "s": Osaka, the
// last of the regions, off-screen down the virtual list until the menu scrolls to it. Each letter changes the
// selection, so the form around the select re-renders.
async function typeOsakaWhileTheMenuOpens(page, vuetify) {
  await page.goto(`/?vuetify=${vuetify}`);
  await page.getByRole("button", { name: "Edit Redshift", exact: true }).click();
  await page.getByText("N. Virginia (us-east-1)", { exact: true }).click();
  const menu = page.locator(".v-overlay--active .v-select__content");
  await expect(menu.getByRole("option", { name: "N. Virginia (us-east-1)", exact: true })).toBeVisible();
  const region = page.getByRole("combobox", { name: "AWS Region", exact: true });
  await region.press("o");
  await region.press("s");
  await expect.poll(() => menu.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  return menu.getByRole("option", { name: "Osaka (ap-northeast-3)", exact: true });
}

async function withFixture(run) {
  const vite = await startViteFixture({ fixtureRoot: TEST_ROOT, configFile: "vite.config.js" });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ baseURL: vite.baseURL, viewport });
      try {
        await run(page, `${viewport.width}px`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
}

test("letters typed while a select's menu opens show and focus their match under JSKIT's Material 3 defaults", {
  skip: SKIP,
  timeout: 90_000
}, async () => {
  await withFixture(async (page, at) => {
    const osaka = await typeOsakaWhileTheMenuOpens(page, "material");
    await expect(osaka, at).toBeVisible();
    await expect(osaka, at).toBeFocused();
    await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), at).toHaveCount(1);
  });
});

// The upstream bug material-web works around by setting no VMenu sub-component defaults
// (https://github.com/vuetifyjs/vuetify/issues/23366; its README, Upstream workarounds): in Vuetify 4.2.1 to 4.3.2,
// with one, the form's re-render rebuilds VMenu's root defaults, the menu's virtual list resets its item height to 0,
// and scrollToIndex gives up. When this test fails, a Vuetify release past 4.3.2 has fixed it: delete this test and
// the fixture's `vmenu-defaults` mode, and a menu's own list may go back to VMenu defaults.
test("Vuetify still loses a select's typeahead match under a VMenu sub-component default when the form re-renders", {
  skip: SKIP,
  timeout: 90_000
}, async () => {
  await withFixture(async (page, at) => {
    await typeOsakaWhileTheMenuOpens(page, "vmenu-defaults");
    await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), at).toHaveCount(1);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(
      focused,
      `${at}: Vuetify now focuses the match under VMenu sub-component defaults; the material-web workaround can come off`
    ).not.toBe("Osaka (ap-northeast-3)");
  });
});
