import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// axe judges the contrast of every text on a shell page. Two things hid every text from it (color-contrast
// "incomplete", bgOverlap), so even text no one can read passed:
// - a closed menu that stays mounted, as ShellLayout's overflow menu does to keep the app bar's own items mounted on a
//   phone, kept Vuetify's overlay root over the whole page: an absolute layer the size of the window at z-index 2000;
// - Vuetify draws a button's, chip's, list item's, card's and avatar's state layer and underlay over its label.
// material.css takes a closed overlay's root away once its content has gone, and draws the state layers under the
// content, as Material 3 orders them.
const SKIP = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1"
  ? false
  : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 to check axe judges the contrast of a shell page's text";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/adaptive-shell");
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT, configFile: "vite.config.mjs" });
const UNREADABLE = "p[data-testid=\"fixture-unreadable\"]";

// What axe may leave unjudged or fail on these pages, each for its reason; anything else fails the test.
// - emptyValue: an empty field has no text to judge.
// - shortTextContent: a label of one or two characters (an icon's ligature, a count) is too short for axe to judge.
// - field outline: an outlined field's text (its value, or its floating label in the outline's notch) lies under the
//   field's own outline, which Vuetify draws as boxes over the field, transparent but for their borders, so the text
//   shows on the field's background (axe-core 4.11 also reports an empty input under its resting label so).
// - disabled chip: a disabled chip's label is Material 3's disabled colour (on-surface at 38%), which WCAG 1.4.3
//   exempts as part of an inactive control; Vuetify marks the chip disabled only with a `disabled` attribute on a
//   span, which axe does not read as disabled.
async function contrastResults(page) {
  if (!(await page.evaluate(() => Boolean(globalThis.axe)))) {
    await page.addScriptTag({ path: AXE_PATH });
  }
  return page.evaluate(async () => {
    const results = await globalThis.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const name = (element) => `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((c) => `.${c}`).join("")}`;
    const nodes = (outcome) => outcome.flatMap((rule) => rule.nodes).map((node) => ({
      node,
      element: document.querySelector(node.target[0]),
      reason: node.any.map((check) => check.data?.messageKey || check.message).join("|")
    }));
    globalThis.axe.setup(document);
    try {
      const incomplete = nodes(results.incomplete).filter(({ element, reason }) => {
        if (reason === "emptyValue" || reason === "shortTextContent") {
          return false;
        }
        const over = (globalThis.axe.commons.dom.getTextElementStack(element)[0] || [])[0];
        const field = element.closest(".v-field");
        return !(reason === "bgOverlap" && field && over && field.contains(over) &&
          over.closest(".v-field__outline, .v-field-label"));
      }).map(({ node, element, reason }) => {
        const stack = globalThis.axe.commons.dom.getTextElementStack(element)[0] || [];
        const over = stack.indexOf(element) > 0 ? ` under ${name(stack[0])}` : "";
        return `${reason}: ${node.target.join(" ")} "${element.textContent.trim().slice(0, 30)}"${over}`;
      });
      const violations = nodes(results.violations)
        .filter(({ element }) => !element.closest(".v-chip--disabled"))
        .map(({ node }) => `${node.target.join(" ")} ${JSON.stringify(node.any.map((check) => check.data?.contrastRatio))}`);
      return { violations, incomplete };
    } finally {
      globalThis.axe.teardown();
    }
  });
}

async function expectJudged(page, where, violations) {
  const results = await contrastResults(page);
  assert.deepEqual(results.violations.map((violation) => violation.split(" [")[0]), violations,
    `${where}: axe's color-contrast failures (${JSON.stringify(results.violations)})`);
  assert.deepEqual(results.incomplete, [], `${where}: every text axe could not judge, with the element over it`);
}

test("axe judges every text on a shell page: unreadable text fails, and no closed menu or state layer covers a label", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);

  // A phone with the app bar's own items: ShellLayout mounts its overflow menu for them (closed, as all three fit);
  // text buttons, a card and the FAB.
  const phone = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  t.after(() => phone.close());
  await phone.goto("/home/notes?topRight=3&unreadable=1");
  await expect(phone.getByTestId("fixture-unreadable")).toBeVisible();
  await expect(phone.getByTestId("jskit-shell-page-actions-overflow-items")).toBeAttached();
  await expectJudged(phone, "notes at 390 with the overflow menu closed", [UNREADABLE]);

  // Segmented buttons, filter chips, an active list item and fields; buttons and chips in every variant and state, an
  // avatar and a pagination; cards in each variant; an outlined field with a value.
  for (const route of ["/home/components?topRight=3", "/home/button-states", "/home/buttons", "/home/feedback"]) {
    await phone.goto(route);
    await expect(phone.getByTestId("jskit-shell-page-title")).toBeVisible();
    await expectJudged(phone, `${route} at 390`, []);
  }

  const desktop = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  t.after(() => desktop.close());
  await desktop.goto("/home/notes?unreadable=1");
  await expect(desktop.getByTestId("fixture-unreadable")).toBeVisible();
  await expectJudged(desktop, "notes at 1280", [UNREADABLE]);
});

test("a menu mounted while closed covers nothing, and still opens and closes with its animation", {
  skip: SKIP,
  timeout: 60_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 } });
  t.after(() => page.close());
  await page.goto("/home/actions?topRight=3&title=Actions");
  const items = page.getByTestId("jskit-shell-page-actions-overflow-items");
  await expect(items).toBeAttached();
  const root = () => items.evaluate((element) => getComputedStyle(element.closest(".v-overlay")).display);
  assert.equal(await root(), "none", "the closed menu's overlay is not drawn");

  await page.getByTestId("jskit-shell-page-actions-overflow").click();
  await expect(page.getByRole("menu")).toBeVisible();
  assert.notEqual(await root(), "none", "the open menu's overlay is drawn");
  await items.evaluate((element) => Promise.all(element.closest(".v-overlay__content").getAnimations().map((animation) => animation.finished)));

  // Frame by frame from Escape until the overlay is gone: its content animates out while the overlay is still drawn.
  const frames = items.evaluate(async (element) => {
    const content = element.closest(".v-overlay__content");
    const overlay = content.parentElement;
    const seen = [];
    const started = performance.now();
    while (performance.now() - started < 3000) {
      const animating = content.getAnimations().some((animation) => animation.playState === "running");
      seen.push({ overlay: getComputedStyle(overlay).display, content: content.style.display || "shown", animating });
      if (seen.at(-1).overlay === "none") {
        break;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return seen;
  });
  await page.keyboard.press("Escape");
  const seen = await frames;
  assert.ok(seen.some((frame) => frame.overlay !== "none" && frame.content === "shown" && frame.animating),
    `the menu animates out while its overlay is drawn: ${JSON.stringify(seen.filter((_, index) => index % 4 === 0))}`);
  assert.equal(seen.at(-1).overlay, "none", "once closed, the menu's overlay is gone again");
  await expect(items).toBeAttached();
});

// A state layer lies under the label, so a hovered, focused or pressed button's label is read against its container
// with the layer over it. Material 3's layers (hover 8%, focus and pressed 10%) keep every label at 4.5:1: a filled
// button's on-colour over its colour, a tonal button's on-container colour over its tint.
test("every button's label keeps 4.5:1 at rest, hovered, focused and pressed, in each colour, variant and theme", {
  skip: SKIP,
  timeout: 180_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const failures = [];
  let judged = 0;
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      baseURL: vite.baseURL,
      colorScheme: theme,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce"
    });
    t.after(() => page.close());
    await page.goto(`/home/button-contrast?theme=${theme}`);
    await expect(page.getByTestId("jskit-shell-page-title")).toHaveText("Button contrast");
    await page.addScriptTag({ path: AXE_PATH });
    const buttons = await page.locator("[data-testid^=contrast-]").all();
    assert.equal(buttons.length, 35, "seven colours in five variants");
    for (const button of buttons) {
      const name = await button.getAttribute("data-testid");
      for (const state of ["rest", "hover", "focus", "pressed"]) {
        if (state === "hover") {
          await button.hover();
        } else if (state === "focus") {
          // A key press first, so the focus shows as keyboard focus.
          await page.keyboard.press("Shift");
          await button.focus();
        } else if (state === "pressed") {
          await button.hover();
          await page.mouse.down();
        }
        const found = await button.evaluate(async (element) => {
          const results = await globalThis.axe.run(element, { runOnly: { type: "rule", values: ["color-contrast"] } });
          const nodes = (outcome) => outcome.flatMap((rule) => rule.nodes);
          return [
            ...nodes(results.violations).map((node) => `${node.any.map((check) => check.data?.contrastRatio).join("|")}:1 ` +
              `(${node.any.map((check) => `${check.data?.fgColor} on ${check.data?.bgColor}`).join("|")})`),
            ...nodes(results.incomplete).map((node) => `unjudged: ${node.any.map((check) => check.data?.messageKey).join("|")}`)
          ];
        });
        judged += 1;
        for (const finding of found) {
          failures.push(`${theme} ${name} ${state}: ${finding}`);
        }
        if (state === "pressed") {
          await page.mouse.up();
        }
        await button.blur();
        await page.mouse.move(1, 300);
        // A released press leaves its ripple fading out for a moment; the next state starts once it has gone.
        await expect(page.locator(".v-ripple__container")).toHaveCount(0);
      }
    }
  }
  assert.equal(judged, 280, "every button judged in four states and two themes");
  assert.deepEqual(failures, [], "every label at 4.5:1 or more in every state");
});
