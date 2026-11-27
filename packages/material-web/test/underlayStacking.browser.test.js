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
  :is(.v-alert, .v-stepper-item, .v-snackbar__wrapper),
  .v-alert > :is(.v-alert__prepend, .v-alert__content, .v-alert__append, .v-alert__close),
  .v-stepper-item > .v-stepper-item__content,
  .v-snackbar__wrapper > :is(.v-snackbar__prepend, .v-snackbar__content, .v-snackbar__actions) { isolation: auto !important; }
  .v-alert > :is(.v-alert__underlay, .v-alert__border),
  .v-stepper-item > :is(.v-stepper-item__overlay, .v-stepper-item__underlay),
  .v-snackbar__wrapper > .v-snackbar__underlay { z-index: auto !important; }
`;

// Each component's texts, by the data-testid of the component (the snackbar's is its overlay's).
const TEXTS = Object.freeze({
  "tonal-alert": ["Backups", "The last backup finished an hour ago."],
  "border-alert": ["Two-step sign-in is on."],
  "icon-button": ["Edit"],
  "tonal-icon-button": ["Copy"],
  "active-icon-button": ["Pinned"],
  stepper: ["Shipping"],
  snackbar: ["Saved the report."]
});

// Focusable expansion panels' texts, the first panel open: its title, its text and the closed panels' titles, one
// of its own colour (primary). A disabled panel's title, tinted as Vuetify tints it, has no text axe judges.
const PANEL_TEXTS = Object.freeze({ panels: ["Billing", "Invoices go to the billing contact.", "Security", "Plan"] });

// Vuetify's state layer for an expansion panel title without a background of its own, its __overlay over the title's
// text, as an unlayered stylesheet that overrides material.css's.
const VUETIFY_STATE_LAYER = `
  .v-expansion-panel-title:not([class*=" bg-"], [style*="background"]) { background-color: transparent !important; }
  .v-expansion-panel-title > .v-expansion-panel-title__overlay { display: inline !important; }
`;

// What axe's color-contrast makes of each component's texts, and what lies on top of each text's first line: in
// axe's model of the page (its element stack, which counts a layer the browser's hit test skips for
// pointer-events: none) and for the browser (elementsFromPoint). "self" is the text's own element. A text of one or
// two characters (a step's number) is too short for axe to judge (shortTextContent).
async function judged(page, textsByComponent) {
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
  }, textsByComponent);
}

// The pixels of two screenshots of the window that differ by more than two levels (of 255) in a channel, and the
// box they lie in. Drawing two translucent layers of one colour in the other order gives the same colour but for its
// rounding: each blend rounds by half a level at most, so the two orders' pixels differ by two levels at most (one in
// almost every pixel, at a text's edges; two in a few, where a snackbar's text meets its tint).
function pixelsBeyondRounding(page, first, second) {
  return page.evaluate(async (screenshots) => {
    const pixels = async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [{ width, data: a }, { data: b }] = await Promise.all(screenshots.map(pixels));
    let count = 0;
    let box = null;
    for (let index = 0; index < a.length; index += 4) {
      if ([0, 1, 2, 3].every((channel) => Math.abs(a[index + channel] - b[index + channel]) <= 2)) continue;
      const [x, y] = [(index / 4) % width, Math.floor(index / 4 / width)];
      count += 1;
      box = box ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) } :
        { left: x, top: y, right: x, bottom: y };
    }
    return { count, box };
  }, [first.toString("base64"), second.toString("base64")]);
}

// Vuetify draws a tonal alert's tint, an alert's border box, an editable step's state layer and underlay and a tonal
// snackbar's tint as positioned boxes after the text they cover, so they lie over it: axe found each over its
// component's text and judged none of it (color-contrast incomplete, bgOverlap). material.css draws them under the
// text, as it does a button's, chip's, list item's, card's and avatar's layers: each component is a stacking context
// with its layers at z-index -1 in it, and each part holding its text is one too, which axe-core 4.14 needs to rank
// the text above the layers. The tint is the text's own colour, so the window shows the same pixels either way, but
// for rounding. Icon buttons, at rest, tonal and active, are judged as Vuetify draws them, and stay so.
test("axe judges the text of a tonal alert, a bordered alert, icon buttons, an editable step and a tonal snackbar, each on top of its component's layers, and the page draws the same as with Vuetify's stacking", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  await expect(page.locator(".v-snackbar__content")).toHaveText("Saved the report.");
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));

  const restacked = await page.screenshot({ animations: "disabled" });
  const style = await page.addStyleTag({ content: VUETIFY_STACKING });
  const asVuetifyStacksThem = await page.screenshot({ animations: "disabled" });
  await style.evaluate((element) => element.remove());

  const texts = Object.values(TEXTS).flat();
  assert.deepEqual({ ...(await judged(page, TEXTS)), pixels: await pixelsBeyondRounding(page, restacked, asVuetifyStacksThem) }, {
    passed: Object.fromEntries(Object.entries(TEXTS).map(([key, list]) => [key, [...list].sort()])),
    failed: [],
    unjudged: [],
    tops: Object.fromEntries(texts.map((text) => [text, "axe self, browser self"])),
    pixels: { count: 0, box: null }
  });
});

// Vuetify draws an expansion panel title's state layer, shown on an open focusable panel, on hover and on keyboard
// focus, as a positioned box over the title's text, a text of the title's own: axe found the layer over the text and
// judged none of it (color-contrast incomplete, bgOverlap). material.css draws the state as the title's own
// background, the text's own colour at the state's opacity, as the layer drew it, so the window shows the same
// pixels either way, but for rounding. A title of its own colour keeps its background and Vuetify's layer: at rest
// axe judges its text on that background (the browser's hit test finds the layer, transparent, which takes clicks),
// and hovered axe finds the layer over its text, as Vuetify draws it.
test("axe judges an expansion panel title's text on top of its state layer, on an open focusable panel, on hover and on keyboard focus, and the page draws the same as with Vuetify's state layer", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  const titles = page.getByTestId("panels").locator(".v-expansion-panel-title");
  await expect(titles).toHaveText(["Billing", "Security", "Plan", "Archive"]);
  await expect(page.getByText("Invoices go to the billing contact.")).toBeVisible();

  const states = {
    "at rest": async () => {},
    "Billing hovered": () => titles.nth(0).hover(),
    "Security hovered": () => titles.nth(1).hover(),
    "Plan hovered": () => titles.nth(2).hover(),
    "Security focused": async () => {
      await page.mouse.move(1, 1);
      await titles.nth(0).focus();
      await page.keyboard.press("Tab");
    },
    "Billing focused": () => page.keyboard.press("Shift+Tab")
  };
  const titlesThat = (state) => titles.evaluateAll((list, selector) => list.filter((title) => title.matches(selector))
    .map((title) => [...title.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim()), state);
  const seen = {};
  for (const [state, reach] of Object.entries(states)) {
    await reach();
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
    const drawn = await page.screenshot({ animations: "disabled" });
    const style = await page.addStyleTag({ content: VUETIFY_STATE_LAYER });
    const asVuetifyDrawsIt = await page.screenshot({ animations: "disabled" });
    await style.evaluate((element) => element.remove());
    seen[state] = {
      hovered: await titlesThat(":hover"),
      focused: await titlesThat(":focus-visible"),
      ...(await judged(page, PANEL_TEXTS)),
      pixels: await pixelsBeyondRounding(page, drawn, asVuetifyDrawsIt)
    };
  }

  const texts = PANEL_TEXTS.panels;
  const layer = "span.v-expansion-panel-title__overlay";
  const tops = Object.fromEntries(texts.map((text) => [text, "axe self, browser self"]));
  const judgedOnTop = (hovered, focused) => ({
    hovered,
    focused,
    passed: { panels: [...texts].sort() },
    failed: [],
    unjudged: [],
    tops: { ...tops, Plan: `axe self, browser ${layer}` },
    pixels: { count: 0, box: null }
  });
  const planUnderItsLayer = {
    ...judgedOnTop(["Plan"], []),
    passed: { panels: texts.filter((text) => text !== "Plan").sort() },
    unjudged: [`bgOverlap: "Plan" (axe ${layer}, browser ${layer})`],
    tops: { ...tops, Plan: `axe ${layer}, browser ${layer}` }
  };
  assert.deepEqual(seen, {
    "at rest": judgedOnTop([], []),
    "Billing hovered": judgedOnTop(["Billing"], []),
    "Security hovered": judgedOnTop(["Security"], []),
    "Plan hovered": planUnderItsLayer,
    "Security focused": judgedOnTop([], ["Security"]),
    "Billing focused": judgedOnTop([], ["Billing"])
  });
});
