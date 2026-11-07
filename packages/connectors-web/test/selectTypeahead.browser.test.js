import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_ROOT = fileURLToPath(new URL(".", import.meta.url));
const SKIP = process.env.JSKIT_CONNECTORS_WEB_BROWSER === "1" ? false : "set JSKIT_CONNECTORS_WEB_BROWSER=1";
const VIEWPORTS = Object.freeze([{ width: 390, height: 1000 }, { width: 1280, height: 1000 }]);

// Opens the page's AWS Region select and, while its menu still scales in, types "o" then "s": Osaka, the last of the
// regions, off-screen down the virtual list until the menu scrolls to it. Each letter changes the selection, so what
// shows it re-renders.
async function typeOsakaWhileTheMenuOpens(page) {
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

// `vmenu-defaults` is an app that adds a VMenu sub-component default to JSKIT's: the form still keeps the match, as its
// fields take the app's root defaults, not each expansion panel's (IntegrationConfigurationFields.vue).
test("letters typed while a configuration select's menu opens show and focus their match, with or without an app's VMenu defaults", {
  skip: SKIP,
  timeout: 90_000
}, async () => {
  await withFixture(async (page, at) => {
    for (const vuetify of ["material", "vmenu-defaults"]) {
      await page.goto(`/?vuetify=${vuetify}`);
      await page.getByRole("button", { name: "Edit Redshift", exact: true }).click();
      const osaka = await typeOsakaWhileTheMenuOpens(page);
      await expect(osaka, `${at}, ${vuetify}`).toBeVisible();
      await expect(osaka, `${at}, ${vuetify}`).toBeFocused();
      await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), `${at}, ${vuetify}`).toHaveCount(1);
    }
  });
});

// The upstream bug material-web works around by setting no VMenu sub-component defaults
// (https://github.com/vuetifyjs/vuetify/issues/23366; its README, Upstream workarounds), on its own in the fixture's
// Vuetify23366.vue: in Vuetify 4.2.1 to 4.3.2, with one, the panel's re-render rebuilds VMenu's root defaults, the
// menu's virtual list resets its item height to 0, and scrollToIndex gives up. When this test fails, a Vuetify release
// past 4.3.2 has fixed it: delete this test, Vuetify23366.vue and the fixture's `vmenu-defaults` mode, and a menu's
// own list may go back to VMenu defaults.
test("Vuetify still loses a select's typeahead match under a VMenu sub-component default when a panel around it re-renders", {
  skip: SKIP,
  timeout: 90_000
}, async () => {
  await withFixture(async (page, at) => {
    await page.goto("/?vuetify=vmenu-defaults&fixture=vuetify-23366");
    await typeOsakaWhileTheMenuOpens(page);
    await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), at).toHaveCount(1);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(
      focused,
      `${at}: Vuetify now focuses the match under VMenu sub-component defaults; the material-web workaround can come off`
    ).not.toBe("Osaka (ap-northeast-3)");
  });
});
