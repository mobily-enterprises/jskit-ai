import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const TEST_ROOT = fileURLToPath(new URL(".", import.meta.url));
const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const FIELDS = 300;

// Opens the fixture with Vuetify's loader modules as published or as material-web's install patch leaves them
// (vite.config.js), and fails on any page error.
async function withLoaders(loaders, run) {
  const vite = await startViteFixture({ fixtureRoot: TEST_ROOT, configFile: "vite.config.js", env: { JSKIT_VUETIFY_LOADERS: loaders } });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = await run(page);
    assert.deepEqual(errors, [], `${loaders}: page errors`);
    return result;
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
}

async function mountFields(page) {
  await page.goto("/?view=fields", { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.mountFields === "function");
  return page.evaluate((count) => window.mountFields(count), FIELDS);
}

const runningAnimations = (locator) => locator.evaluate(
  (element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length
);

// A progress indicator's classes (without the reveal transition's passing one) and size.
async function describeProgress(locator) {
  return locator.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { classes: [...element.classList].filter((name) => !name.endsWith("--revealing")).sort(), width, height };
  });
}

async function expectAnimating(locator, name) {
  await expect.poll(() => runningAnimations(locator), { message: `${name} animates` }).toBeGreaterThan(0);
}

// What the three loaders show once they settle: the loading field's bar and the circular progress at the top, and the
// bar below the fold before and after it scrolls into view (which takes the other two out of view); each animates
// while in view.
async function showLoaders(page) {
  await page.goto("/?view=loaders", { waitUntil: "networkidle" });
  const loadingBar = page.getByTestId("loading-field").locator(".v-field__loader .v-progress-linear");
  const circular = page.getByTestId("circular").locator(".v-progress-circular");
  const belowFold = page.getByTestId("below-fold").locator(".v-progress-linear");
  await expect(loadingBar).toHaveClass(/v-progress-linear--active/u);
  await expectAnimating(loadingBar, "the loading field's bar");
  await expect(circular).toHaveClass(/v-progress-circular--visible/u);
  await expect(circular.locator("svg circle")).not.toHaveCount(0);
  await expectAnimating(circular, "the circular progress");
  const shown = { loadingBar: await describeProgress(loadingBar), circular: await describeProgress(circular) };
  // Off screen, the intersection observer reports the bar hidden, so it stays inactive until it scrolls into view.
  await expect(belowFold).not.toHaveClass(/v-progress-linear--active/u);
  shown.belowFoldBefore = await describeProgress(belowFold);
  await belowFold.scrollIntoViewIfNeeded();
  await expect(belowFold).toHaveClass(/v-progress-linear--active/u);
  await expectAnimating(belowFold, "the bar scrolled into view");
  shown.belowFoldAfter = await describeProgress(belowFold);
  return shown;
}

test("300 fields mount with no layout read from their idle loaders once patched; Vuetify as published reads one per field", {
  skip: SKIP,
  timeout: 180_000
}, async (t) => {
  const published = await withLoaders("published", mountFields);
  const patched = await withLoaders("patched", mountFields);
  t.diagnostic(`${FIELDS} fields, getBoundingClientRect() on .v-progress-linear while mounting: as published ` +
    `${published.progressReads} (${Math.round(published.milliseconds)} ms to mount), patched ${patched.progressReads} ` +
    `(${Math.round(patched.milliseconds)} ms); reads of anything else ${published.otherReads} and ${patched.otherReads}`);
  assert.equal(patched.progressReads, 0, "the patched idle loaders read no layout while the fields mount");
  assert.equal(
    published.progressReads,
    FIELDS,
    "Vuetify as published no longer reads layout in its idle loaders, so vuetifyjs/vuetify#23393 is fixed: remove " +
      "material-web's install patch (scripts/patch-vuetify-loaders.mjs), its tests and this one"
  );
});

test("patched loaders look as published: a loading field's bar, a circular progress and a bar scrolled into view show and animate", {
  skip: SKIP,
  timeout: 180_000
}, async () => {
  const published = await withLoaders("published", showLoaders);
  const patched = await withLoaders("patched", showLoaders);
  assert.deepEqual(patched, published);
});
