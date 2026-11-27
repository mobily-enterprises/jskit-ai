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
  fixtureRoot: fileURLToPath(new URL("./fixtures/underlay-stacking", import.meta.url)),
  configFile: "vite.config.js"
});

// Vuetify's own stacking of the parts material.css restacks, as an unlayered stylesheet that overrides it: the page
// with it is the page as Vuetify draws it.
const VUETIFY_STACKING = `
  :is(.v-alert, .v-stepper-item, .v-snackbar__wrapper, .v-progress-circular),
  .v-alert > :is(.v-alert__prepend, .v-alert__content, .v-alert__append, .v-alert__close),
  .v-stepper-item > .v-stepper-item__content,
  .v-snackbar__wrapper > :is(.v-snackbar__prepend, .v-snackbar__content, .v-snackbar__actions),
  .v-progress-circular > .v-progress-circular__content { isolation: auto !important; }
  .v-alert > :is(.v-alert__underlay, .v-alert__border),
  .v-stepper-item > :is(.v-stepper-item__overlay, .v-stepper-item__underlay),
  .v-snackbar__wrapper > .v-snackbar__underlay { z-index: auto !important; }
  .v-progress-circular > svg { z-index: 0 !important; }
`;

// Each component's texts, by the data-testid of the component (the snackbar's is its overlay's).
const TEXTS = Object.freeze({
  "tonal-alert": ["Backups", "The last backup finished an hour ago."],
  "border-alert": ["Two-step sign-in is on."],
  "icon-button": ["Edit"],
  "tonal-icon-button": ["Copy"],
  "active-icon-button": ["Pinned"],
  stepper: ["Shipping"],
  progress: ["75%"],
  snackbar: ["Saved the report."]
});

// What axe's color-contrast makes of each component's texts, and what lies on top of each text's first line: in
// axe's model of the page (its element stack, which counts a layer the browser's hit test skips for
// pointer-events: none) and for the browser (elementsFromPoint). "self" is the text's own element. A text of one or
// two characters (a step's number) is too short for axe to judge (shortTextContent).
async function judged(page) {
  if (!(await page.evaluate(() => Boolean(globalThis.axe)))) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (texts) => {
    const results = await globalThis.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const name = (element) => `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((c) => `.${c}`).join("")}`;
    const ownText = (element) => [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim();
    const component = (element) => element.closest("[data-testid]")?.dataset.testid ||
      (element.closest(".v-snackbar__wrapper") ? "snackbar" : "page");
    const nodes = (outcome) => outcome.flatMap((rule) => rule.nodes)
      .map((node) => ({ node, element: document.querySelector(node.target[0]) }))
      .filter(({ element }) => element && component(element) in texts);
    const top = (element) => {
      const axeTop = (globalThis.axe.commons.dom.getTextElementStack(element)[0] || [])[0];
      const line = [...element.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(line);
      const box = range.getClientRects()[0];
      const browserTop = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)[0];
      const show = (over) => (over === element ? "self" : over ? name(over) : "nothing");
      return `axe ${show(axeTop)}, browser ${show(browserTop)}`;
    };
    globalThis.axe.setup(document);
    try {
      const passed = Object.fromEntries(Object.keys(texts).map((key) => [key, []]));
      for (const { element } of nodes(results.passes)) passed[component(element)].push(ownText(element));
      for (const key of Object.keys(passed)) passed[key].sort();
      const tops = {};
      for (const key of Object.keys(texts)) {
        for (const element of document.querySelectorAll("*")) {
          if (component(element) === key && texts[key].includes(ownText(element))) tops[ownText(element)] = top(element);
        }
      }
      return {
        passed,
        failed: nodes(results.violations).map(({ element }) => ownText(element)),
        unjudged: nodes(results.incomplete)
          .map(({ node, element }) => ({ reason: node.any.map((check) => check.data?.messageKey || check.message).join("|"), element }))
          .filter(({ reason }) => reason !== "shortTextContent")
          .map(({ reason, element }) => `${reason}: "${ownText(element)}" (${top(element)})`),
        tops
      };
    } finally {
      globalThis.axe.teardown();
    }
  }, TEXTS);
}

// How many pixels of two screenshots of the window differ, and by how much at most in any channel.
function pixelDifference(page, first, second) {
  return page.evaluate(async (screenshots) => {
    const pixels = async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [a, b] = await Promise.all(screenshots.map(pixels));
    let differing = 0;
    let maxDelta = 0;
    for (let index = 0; index < a.length; index += 4) {
      const delta = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a[index + channel] - b[index + channel])));
      if (delta > 0) differing += 1;
      maxDelta = Math.max(maxDelta, delta);
    }
    return { differing, maxDelta };
  }, [first.toString("base64"), second.toString("base64")]);
}

// Vuetify draws a tonal alert's tint, an alert's border box, an editable step's state layer and underlay, a tonal
// snackbar's tint and a circular progress's ring (an svg at z-index 0) as positioned boxes after the text they cover,
// so they lie over it: axe found each over its component's text and judged none of it (color-contrast incomplete,
// bgOverlap). material.css draws them under the text, as it does a button's, chip's, list item's, card's and avatar's
// layers: each component is a stacking context with its layers at z-index -1 in it, and each part holding its text
// is one too, which axe-core 4.14 needs to rank the text above the layers. The tint is the text's own colour, so the
// window shows the same pixels either way. Icon buttons, at rest, tonal and active, are judged as Vuetify draws them,
// and stay so.
test("axe judges the text of a tonal alert, a bordered alert, icon buttons, an editable step, a tonal snackbar and a circular progress's reading, each on top of its component's layers, and the page draws the same as with Vuetify's stacking", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  await expect(page.locator(".v-snackbar__content")).toHaveText("Saved the report.");
  await expect(page.getByTestId("progress")).toHaveText("75%");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));

  const restacked = await page.screenshot({ animations: "disabled" });
  const style = await page.addStyleTag({ content: VUETIFY_STACKING });
  const asVuetifyStacksThem = await page.screenshot({ animations: "disabled" });
  await style.evaluate((element) => element.remove());

  const texts = Object.values(TEXTS).flat();
  assert.deepEqual({ ...(await judged(page)), pixels: await pixelDifference(page, restacked, asVuetifyStacksThem) }, {
    passed: Object.fromEntries(Object.entries(TEXTS).map(([key, list]) => [key, [...list].sort()])),
    failed: [],
    unjudged: [],
    tops: Object.fromEntries(texts.map((text) => [text, "axe self, browser self"])),
    pixels: { differing: 0, maxDelta: 0 }
  });
});
