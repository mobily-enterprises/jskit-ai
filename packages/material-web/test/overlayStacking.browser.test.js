import assert from "node:assert/strict";
import { createRequire } from "node:module";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/overlay-stacking", import.meta.url)),
  configFile: "vite.config.js"
});

// The dialog's texts, as axe's color-contrast found them: judged and passed, judged and failed, or left unjudged with
// axe's reason.
async function dialogContrast(page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const results = await globalThis.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const inDialog = (outcome) => outcome.flatMap((rule) => rule.nodes)
      .map((node) => ({ node, element: document.querySelector(node.target[0]) }))
      .filter(({ element }) => element?.closest(".v-dialog"));
    const text = (element) => element.textContent.trim();
    return {
      passed: inDialog(results.passes).map(({ element }) => text(element)).sort(),
      failed: inDialog(results.violations).map(({ element }) => text(element)),
      unjudged: inDialog(results.incomplete).map(({ node, element }) => (
        `${node.any.map((check) => check.data?.messageKey || check.message).join("|")}: "${text(element)}"`
      ))
    };
  });
}

// What the page draws: the elements under the middle of each of the dialog's texts and of the page's lines behind it,
// top first, as the browser hit-tests them, and the pixels of the whole window.
async function drawn(page) {
  const points = await page.evaluate(() => {
    const name = (element) => `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`;
    const texts = [...document.querySelectorAll(".v-dialog .v-card-title, .v-dialog .v-card-text, .v-dialog .v-btn__content, [data-testid=page-behind] > p")];
    return texts.map((text) => {
      const box = text.getBoundingClientRect();
      const under = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return `${text.textContent.trim().slice(0, 12)}: ${under.slice(0, 4).map(name).join(" > ")}`;
    });
  });
  return { points, pixels: await page.screenshot({ animations: "disabled" }) };
}

// axe-core 4.14 counts `contain: layout` as a stacking context without asking whether the element draws a box.
// Vuetify's overlay container (`.v-overlay-container`, where every dialog, menu, tooltip and snackbar is placed) has
// `contain: layout` with `display: contents`, which draws none, so for the browser it contains nothing; axe made it a
// stacking context at the page's base level and ranked every overlay in it under any of the page's elements with a
// z-index of 1 or more. Over such an element, axe found the page over the dialog's text and judged none of it
// (color-contrast incomplete, bgOverlap): mobilynet's dialogs, over its pages' content at z-index 1. axe-core 4.11 did
// not read `contain`. material.css sets the container's `contain` to none, which the browser draws the same: the same
// elements under every text, and the same pixels, as with Vuetify's own value.
test("axe judges every text of a dialog open over page content with a z-index of its own, and the page draws the same as with Vuetify's `contain: layout` on the overlay container", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  await expect(page.getByTestId("dialog-card")).toBeVisible();
  await expect(page.getByTestId("page-behind")).toBeAttached();
  // The dialog has finished opening: no animation is running (a card's progress line stays mounted, paused).
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));

  assert.deepEqual(await dialogContrast(page), {
    passed: ["Cancel", "Edit the name", "Save", "The name shows on every page of the project."],
    failed: [],
    unjudged: []
  }, "axe judges each of the dialog's texts and passes it");

  const container = page.locator(".v-overlay-container");
  await expect(container).toHaveCount(1);
  assert.equal(await container.evaluate((element) => getComputedStyle(element).contain), "none");
  const withNone = await drawn(page);
  await container.evaluate((element) => { element.style.contain = "layout"; });
  assert.equal(await container.evaluate((element) => getComputedStyle(element).contain), "layout");
  const withLayout = await drawn(page);
  assert.equal(withNone.points.length, 44, "the dialog's four texts and the page's forty lines");
  assert.deepEqual(withNone.points, withLayout.points, "the same elements under every text");
  assert.ok(withNone.pixels.equals(withLayout.pixels), "the same pixels");
});
