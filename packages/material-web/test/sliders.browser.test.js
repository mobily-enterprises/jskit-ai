import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";
import { materialThemes } from "../src/client/index.js";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/sliders", import.meta.url)),
  configFile: "vite.config.js"
});

// A theme colour as the "r, g, b" a computed style holds.
const channels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ");

// What a slider part draws: its colour and its opacity on the page, which is its colour's alpha times its own opacity
// and every ancestor's.
function drawn(locator) {
  return locator.evaluate((element) => {
    const [red, green, blue, alpha = 1] = getComputedStyle(element).backgroundColor.match(/[\d.]+/gu).map(Number);
    let opacity = alpha;
    for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return { color: `${red}, ${green}, ${blue}`, opacity: Math.round(opacity * 1000) / 1000 };
  });
}

// Material 3's slider: the active track and the handle in primary and the inactive track in secondary-container, all
// at full strength; disabled, on-surface at 38% for the active track and the handle and 12% for the inactive track.
test("sliders draw Material 3's tracks and handle, at full strength when enabled and at 38% and 12% when disabled", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const part = (testId, selector) => drawn(page.getByTestId(testId).locator(selector).first());
    for (const testId of ["slider", "range-slider"]) {
      const enabled = (role) => ({ color: channels(colors[role]), opacity: 1 });
      assert.deepEqual(await part(testId, ".v-slider-track__background"), enabled("secondary-container"), `${scheme} ${testId}: inactive track`);
      assert.deepEqual(await part(testId, ".v-slider-track__fill"), enabled("primary"), `${scheme} ${testId}: active track`);
      assert.deepEqual(await part(testId, ".v-slider-thumb__surface"), enabled("primary"), `${scheme} ${testId}: handle`);
    }
    const disabled = (opacity) => ({ color: channels(colors["on-surface"]), opacity });
    assert.deepEqual(await part("disabled-slider", ".v-slider-track__background"), disabled(0.12), `${scheme} disabled: inactive track`);
    assert.deepEqual(await part("disabled-slider", ".v-slider-track__fill"), disabled(0.38), `${scheme} disabled: active track`);
    assert.deepEqual(await part("disabled-slider", ".v-slider-thumb__surface"), disabled(0.38), `${scheme} disabled: handle`);
  }
});

// Material 3's slider at its default size, Vuetify's pill variant: a 16dp track, a 4x44dp handle bar with a gap between
// it and the inactive track, and a stop indicator in the active colour at the end of the inactive track.
test("sliders have Material 3's 16dp track, a 4x44dp handle bar set apart from the track, and a stop indicator", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const { colors } = materialThemes("#6750A4").light;
  const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  for (const testId of ["slider", "range-slider", "disabled-slider"]) {
    const slider = page.getByTestId(testId);
    const box = (selector) => slider.locator(selector).last().boundingBox();
    const [track, handle, inactive] = await Promise.all(
      [".v-slider-track", ".v-slider-thumb__surface", ".v-slider-track__background--after"].map(box)
    );
    assert.equal(track.height, 16, `${testId}: track height`);
    assert.deepEqual([handle.width, handle.height], [4, 44], `${testId}: handle`);
    assert.ok(inactive.x - (handle.x + handle.width) >= 4, `${testId}: a gap between the handle and the inactive track`);
  }
  for (const testId of ["slider", "range-slider"]) {
    const stop = drawn(page.getByTestId(testId).locator(".v-slider-track__stop--end"));
    assert.deepEqual(await stop, { color: channels(colors.primary), opacity: 1 }, `${testId}: stop indicator`);
  }
});
