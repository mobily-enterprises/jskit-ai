import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";
import { materialThemes } from "../src/client/index.js";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/accessibility", import.meta.url)),
  configFile: "vite.config.js"
});

// A theme colour as the "r, g, b" a drawn part is measured in.
const channels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ");

// What a piece of text shows on the page: its colour, the background under it and its contrast ratio, as axe's
// color-contrast measures it. Colours are painted on a canvas so that rgb(), color(srgb ...) and color-mix() all read
// as 8-bit channels. The text's opacity is its colour's alpha times its own opacity and every ancestor's; the
// background is the nearest opaque one, under a tonal card's underlay.
function drawnText(locator) {
  return locator.evaluate((text) => {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const paint = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return { red, green, blue, alpha: alpha / 255 };
    };
    const mix = (top, bottom, alpha) => ({
      red: top.red * alpha + bottom.red * (1 - alpha),
      green: top.green * alpha + bottom.green * (1 - alpha),
      blue: top.blue * alpha + bottom.blue * (1 - alpha),
      alpha: 1
    });
    const luminance = ({ red, green, blue }) => {
      const linear = (channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };
    let background = null;
    const underlays = [];
    for (let node = text; node && !background; node = node.parentElement) {
      const underlay = node.querySelector(":scope > .v-card__underlay");
      if (underlay) underlays.unshift(underlay);
      const colour = paint(getComputedStyle(node).backgroundColor);
      if (colour.alpha === 1) background = colour;
    }
    for (const underlay of underlays) {
      const layer = paint(getComputedStyle(underlay).backgroundColor);
      background = mix(layer, background, layer.alpha * Number(getComputedStyle(underlay).opacity));
    }
    let opacity = 1;
    for (let node = text; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    const colour = paint(getComputedStyle(text).color);
    const shown = mix(colour, background, colour.alpha * opacity);
    const [lighter, darker] = [luminance(shown), luminance(background)].sort((a, b) => b - a);
    return {
      color: `${colour.red}, ${colour.green}, ${colour.blue}`,
      opacity: Math.round(colour.alpha * opacity * 1000) / 1000,
      background: `${Math.round(background.red)}, ${Math.round(background.green)}, ${Math.round(background.blue)}`,
      ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
    };
  });
}

// Vuetify 4.3 mounts a tooltip before it first shows (eager): hidden, it is a role="tooltip" overlay whose text alone
// is hidden, so assistive technology met an empty tooltip (axe aria-tooltip-name), and the activator's
// aria-describedby, which names that overlay, read nothing. material.css hides the overlay whole while its text is
// hidden: no tooltip without a name, and the activator described by the tooltip's text, hidden or shown.
test("a hidden tooltip leaves no tooltip without a name and still describes its button: WCAG 4.1.2 (axe aria-tooltip-name)", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, reducedMotion: "reduce" });
  await page.goto("/");
  const button = page.getByTestId("tooltip-activator");
  await expect(button).toBeVisible();
  // Vuetify has mounted the tooltip with its text hidden inside it before it ever showed.
  const content = page.locator(".v-tooltip > .v-overlay__content");
  await expect(content).toHaveCount(1);
  await expect(content).toHaveText("Delete this report");
  await expect(content).toBeHidden();

  await expect(page.getByRole("tooltip"), "no tooltip in the accessibility tree while hidden").toHaveCount(0);
  await expect(button).toHaveAccessibleName("Delete");
  await expect(button).toHaveAccessibleDescription("Delete this report");

  await button.hover();
  await expect(page.getByRole("tooltip", { name: "Delete this report" })).toBeVisible();
  await expect(button).toHaveAccessibleDescription("Delete this report");

  await page.mouse.move(0, 0);
  await expect(content).toBeHidden();
  await expect(page.getByRole("tooltip"), "none again once it hides").toHaveCount(0);
  await expect(button).toHaveAccessibleDescription("Delete this report");
});

// A card's subtitle is its supporting text, at full strength: on-surface-variant on a surface card or one without a
// colour, the card's own text colour on a coloured card, and its own class's colour when it has one. At Vuetify's
// medium-emphasis opacity it measured 4.35:1 on JSKIT's default surface-container-low card, under WCAG's 4.5:1.
test("a card's subtitle reads at 4.5:1 or more on every card, in light and dark: WCAG 1.4.3 (axe color-contrast)", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const subtitles = {
      "default-card": ["on-surface-variant", "surface-container-low"],
      "surface-card": ["on-surface-variant", "surface-container-high"],
      "uncoloured-card": ["on-surface-variant", "surface"],
      "primary-card": ["on-primary", "primary"],
      "tonal-card": ["primary"],
      "subtitle-class-card": ["error", "surface-container-low"]
    };
    for (const [testId, [role, background]] of Object.entries(subtitles)) {
      const at = `${scheme} ${testId}`;
      const subtitle = await drawnText(page.getByTestId(testId).locator(".v-card-subtitle"));
      assert.ok(subtitle.ratio >= 4.5, `${at}: the subtitle's contrast was ${subtitle.ratio}:1`);
      assert.equal(subtitle.opacity, 1, `${at}: the subtitle is at full strength`);
      assert.equal(subtitle.color, channels(colors[role]), `${at}: the subtitle is ${role}`);
      if (background) assert.equal(subtitle.background, channels(colors[background]), `${at}: on ${background}`);
    }
    await page.close();
  }
});

// A text field's character counter is supporting text beside its messages, at full strength: on-surface-variant on
// a valid field, error on an invalid one or past its limit, and a disabled field's keeps its fade. At Vuetify's
// medium-emphasis opacity it measured 4.19:1 on a dialog's surface-container-high, under WCAG's 4.5:1.
test("a text field's character counter reads at 4.5:1 or more on a dialog's surface, in light and dark: WCAG 1.4.3 (axe color-contrast)", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const counters = {
      "counter-field": ["on-surface-variant", "3 / 20"],
      "invalid-counter-field": ["error", "2 / 20"],
      "over-counter-field": ["error", "7 / 4"]
    };
    for (const [testId, [role, text]] of Object.entries(counters)) {
      const at = `${scheme} ${testId}`;
      const counter = page.getByTestId(testId).locator(".v-counter");
      await expect(counter, at).toHaveText(text);
      const drawn = await drawnText(counter);
      assert.ok(drawn.ratio >= 4.5, `${at}: the counter's contrast was ${drawn.ratio}:1`);
      assert.equal(drawn.opacity, 1, `${at}: the counter is at full strength`);
      assert.equal(drawn.color, channels(colors[role]), `${at}: the counter is ${role}`);
      assert.equal(drawn.background, channels(colors["surface-container-high"]), `${at}: on surface-container-high`);
    }
    // WCAG exempts a disabled control's text: it keeps the field's own fade.
    const disabled = await drawnText(page.getByTestId("disabled-counter-field").locator(".v-counter"));
    assert.ok(disabled.opacity < 1, `${scheme}: a disabled field's counter keeps its fade (${disabled.opacity})`);
    await page.close();
  }
});

// A radio group's own label and a selection control's description are supporting text, at full strength in
// on-surface-variant; a checkbox's own label is on-surface, as Vuetify already draws it. At Vuetify's medium-emphasis
// opacity a group's label measured 4.19:1 in a dialog's surface-container-high ("Flag to raise"), under WCAG's 4.5:1.
test("a radio group's label and a checkbox's label and description read at 4.5:1 or more on a dialog's surface, in light and dark: WCAG 1.4.3 (axe color-contrast)", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    const texts = {
      "radio group's label": [page.getByTestId("radio-group-field").locator(".v-input__control > .v-label"), "on-surface-variant", "Flag to raise"],
      "checkbox's label": [page.getByTestId("checkbox-field").locator(".v-selection-control .v-label"), "on-surface", "Include archived records"],
      "checkbox's description": [page.getByTestId("checkbox-field").locator(".v-selection-control__description"), "on-surface-variant", "Archived records are read-only"]
    };
    for (const [name, [locator, role, text]] of Object.entries(texts)) {
      const at = `${scheme} ${name}`;
      await expect(locator, at).toHaveText(text);
      const drawn = await drawnText(locator);
      assert.ok(drawn.ratio >= 4.5, `${at}: the contrast was ${drawn.ratio}:1`);
      assert.equal(drawn.opacity, 1, `${at}: at full strength`);
      assert.equal(drawn.color, channels(colors[role]), `${at}: ${role}`);
      assert.equal(drawn.background, channels(colors["surface-container-high"]), `${at}: on surface-container-high`);
    }
    // WCAG exempts a disabled control's text: a disabled group's label keeps its fade.
    const disabled = await drawnText(page.getByTestId("disabled-radio-group-field").locator(".v-input__control > .v-label"));
    assert.ok(disabled.opacity < 1, `${scheme}: a disabled radio group's label keeps its fade (${disabled.opacity})`);
    await page.close();
  }
});
