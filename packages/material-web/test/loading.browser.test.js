import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";
import { materialThemes } from "../src/client/index.js";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/loading", import.meta.url)),
  configFile: "vite.config.js"
});

// The bones Vuetify colours; the list-item, card and other bones only lay them out.
const BONES = ["avatar", "button", "chip", "divider", "heading", "image", "ossein", "text"];

// A theme colour as the "r, g, b" a drawn part is measured in.
const channels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ");

// What a part draws with one colour property (background-color, or stroke for an SVG path): the colour, painted on a
// canvas so that rgb(), color(srgb ...) and color-mix() results all read as 8-bit channels, and its opacity on the
// page, which is the colour's alpha times the part's own opacity and every ancestor's.
function drawn(locator, property = "backgroundColor") {
  return locator.evaluate((element, colourProperty) => {
    const style = getComputedStyle(element);
    const value = style[colourProperty] === "currentcolor" ? style.color : style[colourProperty];
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    let opacity = alpha / 255;
    for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return { color: `${red}, ${green}, ${blue}`, opacity: Math.round(opacity * 1000) / 1000 };
  }, property);
}

// A bone's shimmer is its ::after: a gradient laid over the bone, which the bone's own colour leaves in place.
const SHIMMER = Object.freeze({ gradient: true, position: "absolute", zIndex: "1" });
function shimmer(locator) {
  return locator.evaluate((element) => {
    const after = getComputedStyle(element, "::after");
    return { gradient: after.backgroundImage.startsWith("linear-gradient("), position: after.position, zIndex: after.zIndex };
  });
}

// Material 3 has no skeleton component; a bone is surface-container-highest, its most emphasized neutral container,
// a pale placeholder on every lower surface. Vuetify paints a bone in on-surface at the theme's border opacity, which
// the Material 3 outline roles need at full strength, so without material.css's rule every bone is solid on-surface.
test("skeleton bones are surface-container-highest under the shimmer in light and dark, canvastext in forced colours", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const seen = new Set();
    for (const testId of ["list-row", "bones"]) {
      const loader = page.getByTestId(testId).locator(".v-skeleton-loader");
      for (const bone of BONES) {
        const parts = loader.locator(`.v-skeleton-loader__bone.v-skeleton-loader__${bone}`);
        for (let index = 0; index < await parts.count(); index += 1) {
          seen.add(bone);
          const label = `${scheme} ${testId}: ${bone} bone ${index + 1}`;
          const surface = { color: channels(colors["surface-container-highest"]), opacity: 1 };
          assert.deepEqual(await drawn(parts.nth(index)), surface, label);
          assert.deepEqual(await shimmer(parts.nth(index)), SHIMMER, `${label}: shimmer`);
        }
      }
    }
    assert.deepEqual([...seen].sort(), BONES, `${scheme}: the fixture draws every coloured bone`);
    await page.close();
  }
  // Forced colours keep Vuetify's canvastext bones, the page's forced text colour, over the forced Canvas around them.
  const page = await browser.newPage({ baseURL: vite.baseURL, forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/");
  const canvasText = await drawn(page.locator("body"), "color");
  for (const bone of BONES) {
    const part = page.locator(`.v-skeleton-loader__bone.v-skeleton-loader__${bone}`).first();
    assert.deepEqual(await drawn(part), canvasText, `forced colours: ${bone} bone`);
  }
  await page.close();
});

// Material 3's linear progress indicator: the active indicator and the stop in the app's colour, the track in
// secondary-container, all at full strength. Vuetify paints the track in the bar's colour at the border opacity, so
// without the VProgressLinear default the track is as solid as the bar and a determinate one reads as full.
test("linear progress indicators draw a secondary-container track beside the bar, light and dark", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const full = (role) => ({ color: channels(colors[role]), opacity: 1 });
    const part = (testId, selector, property) => drawn(page.getByTestId(testId).locator(selector).first(), property);
    for (const [testId, role] of [["progress", "primary"], ["progress-tertiary", "tertiary"]]) {
      const label = `${scheme} ${testId}`;
      assert.deepEqual(await part(testId, ".v-progress-linear__background"), full("secondary-container"), `${label}: track`);
      assert.deepEqual(await part(testId, ".v-progress-linear__determinate"), full(role), `${label}: active indicator`);
      assert.deepEqual(await part(testId, ".v-progress-linear__stop"), full(role), `${label}: stop indicator`);
    }
    assert.deepEqual(
      await part("progress-indeterminate", ".v-progress-linear__indeterminate > .v-progress-linear__background"),
      full("secondary-container"),
      `${scheme} indeterminate: track`
    );
    const wavyTrack = page.getByTestId("progress-wavy").locator(".v-progress-linear__wavy > .v-progress-linear__track");
    await wavyTrack.first().waitFor({ state: "attached" });
    assert.deepEqual(await drawn(wavyTrack.first(), "stroke"), full("secondary-container"), `${scheme} wavy: track`);
    await page.close();
  }
});
