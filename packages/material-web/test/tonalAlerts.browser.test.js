import assert from "node:assert/strict";
import { createRequire } from "node:module";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";
import { materialThemes } from "../src/client/index.js";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/tonal-alerts", import.meta.url)),
  configFile: "vite.config.js"
});

// The fixture's colours, each with a container role, and the surfaces it draws them on (fixtures/tonal-alerts).
const COLORS = Object.freeze(["primary", "secondary", "tertiary", "error", "warning", "info", "success"]);
const SURFACES = Object.freeze(["page", "card", "dialog"]);

// axe's color-contrast verdict on the texts of each alert on the page, by the alert's data-testid and the text: what
// it made of the text (passed, failed or unjudged), the text's colour and the background it measured under it, and
// the ratio of the two.
async function judgedAlertTexts(page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const results = await globalThis.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const ownText = (element) => [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim();
    const verdicts = {};
    for (const [outcome, found] of [["passed", results.passes], ["failed", results.violations], ["unjudged", results.incomplete]]) {
      for (const node of found.flatMap((rule) => rule.nodes)) {
        const element = document.querySelector(node.target[0]);
        const alert = element?.closest(".v-alert[data-testid]");
        if (!alert) continue;
        const data = node.any[0]?.data || {};
        verdicts[`${alert.dataset.testid}: ${ownText(element)}`] = {
          outcome,
          fg: String(data.fgColor || "").toLowerCase(),
          bg: String(data.bgColor || "").toLowerCase(),
          ratio: data.contrastRatio
        };
      }
    }
    return verdicts;
  });
}

// Vuetify draws a tonal alert's texts in its colour over a tint of that colour, at the activated opacity, over
// whatever surface the alert lies on: a tonal error alert's text read 4.48:1 in a light dialog (surface-container-high),
// under WCAG's 4.5:1, on control's refused dialogs. Material 3's tonal surface is a colour's container, with its text
// in the colour's on-container role, whatever lies under it: every tonal alert in a colour with a container role is
// drawn so, on the page, in a card and in a dialog, in light and dark, and axe judges each text so.
test("a tonal alert in each colour with a container role is its container with on-container text, at 4.5:1 or more on the page, in a card and in a dialog, in light and dark: WCAG 1.4.3 (axe color-contrast)", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const seen = {};
  const expected = {};
  for (const scheme of ["light", "dark"]) {
    const { colors } = materialThemes("#6750A4")[scheme];
    for (const surface of SURFACES) {
      const page = await browser.newPage({ baseURL: vite.baseURL, colorScheme: scheme, reducedMotion: "reduce", viewport: { width: 1280, height: 1400 } });
      try {
        await page.goto(`/?surface=${surface}`);
        await expect(page.locator(".v-alert")).toHaveCount(COLORS.length);
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
        const verdicts = await judgedAlertTexts(page);
        for (const color of COLORS) {
          for (const text of [`The ${color} alert`, `What the ${color} alert says.`]) {
            const at = `${scheme} ${surface} ${color}: ${text}`;
            const verdict = verdicts[`${color}: ${text}`];
            seen[at] = !verdict ? "not judged" : verdict.outcome === "passed" ? `passed: ${verdict.fg} on ${verdict.bg}`
              : `${verdict.outcome} at ${verdict.ratio}:1: ${verdict.fg} on ${verdict.bg}`;
            expected[at] = `passed: ${colors[`on-${color}-container`].toLowerCase()} on ${colors[`${color}-container`].toLowerCase()}`;
          }
        }
      } finally {
        await page.close();
      }
    }
  }
  assert.deepEqual(seen, expected);
});
