import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_ROOT = fileURLToPath(new URL(".", import.meta.url));
const SKIP = process.env.JSKIT_CONNECTORS_WEB_BROWSER === "1" ? false : "set JSKIT_CONNECTORS_WEB_BROWSER=1";
const VIEWPORTS = Object.freeze([{ width: 390, height: 1000 }, { width: 1280, height: 1000 }]);
// One fixture server and one Chromium for the file, warmed before its first test runs (sharedBrowserFixture). A server
// per test started and compiled the app inside that test's 90 s; with 16 browser test files at once the first test
// took up to 75 s.
const open = sharedBrowserFixture({ fixtureRoot: TEST_ROOT, configFile: "vite.config.js" });

// Opens the page's AWS Region select and, while its menu still scales in, types "o" and, once its match Ohio shows,
// "s": Osaka, the last of the regions, off-screen down the virtual list until the menu scrolls to it. Each letter
// changes the selection, so what shows it re-renders.
//
// Vuetify reads the two letters as one search only when its keydown handler runs for "s" within 1000 ms of "o"
// (VSelect's KEYBOARD_LOOKUP_THRESHOLD); later, "s" starts a new search and selects São Paulo. A loaded machine can
// handle "s" that late, so the page's clock reads 1 ms after "o" while "s" is dispatched: the letters are one search
// however late "s" lands, as a person typing "os" makes them. `typed` records the real gap and the selected region for
// the assertions' messages.
async function typeOsakaWhileTheMenuOpens(page) {
  await page.getByText("N. Virginia (us-east-1)", { exact: true }).click();
  const menu = page.locator(".v-overlay--active .v-select__content");
  await expect(menu.getByRole("option", { name: "N. Virginia (us-east-1)", exact: true })).toBeVisible();
  const region = page.getByRole("combobox", { name: "AWS Region", exact: true });
  const selected = page.locator(".v-select", { has: region }).locator(".v-select__selection-text");
  await page.evaluate(() => {
    const keys = {};
    window.typeaheadKeys = keys;
    window.addEventListener("keydown", (event) => {
      keys[event.key] = performance.now();
      if (event.key === "s" && keys.o !== undefined) performance.now = () => keys.o + 1;
    }, { capture: true });
    window.addEventListener("keydown", () => delete performance.now);
  });
  await region.press("o");
  await expect(selected).toHaveText("Ohio (us-east-2)");
  await region.press("s");
  await expect.poll(() => menu.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  const gap = await page.evaluate(() => Math.round(window.typeaheadKeys.s - window.typeaheadKeys.o));
  const typed = `"s" ${gap} ms after "o", selected ${await selected.textContent()}`;
  return { osaka: menu.getByRole("option", { name: "Osaka (ap-northeast-3)", exact: true }), typed };
}

async function eachViewport(t, run) {
  const { vite, browser } = await open(t);
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport });
    try {
      await run(page, `${viewport.width}px`);
    } finally {
      await page.close();
    }
  }
}

// `vmenu-defaults` is an app that adds a VMenu sub-component default to JSKIT's: the form still keeps the match, as its
// fields take the app's root defaults, not each expansion panel's (IntegrationConfigurationFields.vue).
test("letters typed while a configuration select's menu opens show and focus their match, with or without an app's VMenu defaults", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  await eachViewport(t, async (page, at) => {
    for (const vuetify of ["material", "vmenu-defaults"]) {
      await page.goto(`/?vuetify=${vuetify}`);
      await page.getByRole("button", { name: "Edit Redshift", exact: true }).click();
      const { osaka, typed } = await typeOsakaWhileTheMenuOpens(page);
      await expect(osaka, `${at}, ${vuetify}, ${typed}`).toBeVisible();
      await expect(osaka, `${at}, ${vuetify}, ${typed}`).toBeFocused();
      await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), `${at}, ${vuetify}, ${typed}`).toHaveCount(1);
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
}, async (t) => {
  await eachViewport(t, async (page, at) => {
    await page.goto("/?vuetify=vmenu-defaults&fixture=vuetify-23366");
    const { typed } = await typeOsakaWhileTheMenuOpens(page);
    await expect(page.locator(".v-select__selection-text", { hasText: "Osaka" }), `${at}, ${typed}`).toHaveCount(1);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(
      focused,
      `${at}: Vuetify now focuses the match under VMenu sub-component defaults; the material-web workaround can come off`
    ).not.toBe("Osaka (ap-northeast-3)");
  });
});
