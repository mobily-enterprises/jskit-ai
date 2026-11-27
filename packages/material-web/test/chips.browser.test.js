import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/chips", import.meta.url)),
  configFile: "vite.config.js"
});

// Where a chip, its content and its label's text are drawn (left, top, right, bottom, to a tenth of a pixel), and how
// its content lays out and clips.
function chipGeometry(locator) {
  return locator.evaluate((chip) => {
    const content = chip.querySelector(":scope > .v-chip__content");
    const text = document.createRange();
    text.selectNodeContents(content);
    const box = (rect) => [rect.left, rect.top, rect.right, rect.bottom].map((value) => Math.round(value * 10) / 10);
    const style = getComputedStyle(content);
    return {
      chip: box(chip.getBoundingClientRect()),
      content: box(content.getBoundingClientRect()),
      text: box(text.getBoundingClientRect()),
      display: style.display,
      overflow: style.overflowX,
      textOverflow: style.textOverflow,
      clipped: content.scrollWidth > content.clientWidth
    };
  });
}

// Vuetify's own chip content (inline-flex, unclipped), unlayered so it wins over material.css's layers.
const VUETIFY_CHIP_CONTENT = ".v-chip > .v-chip__content { display: inline-flex; min-width: auto; overflow: visible; text-overflow: clip; }";

// A chip is at most as wide as its container, and its label stays on one line, so a label longer than the chip was cut
// mid-word at the chip's edge, or drawn past it on a chip you press. It ends in an ellipsis inside the chip, as a
// button's does; a chip whose label holds elements of its own keeps Vuetify's layout, and a short label is unchanged.
test("a chip's label longer than its chip ends in an ellipsis inside it; a short label and one holding an element are drawn as before", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  await page.getByTestId("slot-chip").waitFor();
  const column = await page.getByTestId("column").evaluate((element) => element.getBoundingClientRect().right);

  for (const testId of ["long-chip", "long-pressable-chip"]) {
    const drawn = await chipGeometry(page.getByTestId(testId));
    assert.ok(drawn.chip[2] <= column, `${testId} ends at ${drawn.chip[2]}, inside its ${column}px column`);
    assert.ok(drawn.content[2] <= drawn.chip[2], `${testId}'s label ends at ${drawn.content[2]}, inside the chip (${drawn.chip[2]})`);
    assert.deepEqual([drawn.overflow, drawn.textOverflow, drawn.clipped], ["hidden", "ellipsis", true],
      `${testId}'s label is clipped with an ellipsis`);
  }

  const unchanged = ["short-chip", "icon-chip", "slot-chip"];
  const ours = [];
  for (const testId of unchanged) ours.push(await chipGeometry(page.getByTestId(testId)));
  assert.equal(ours[2].display, "inline-flex", "a label holding an element keeps Vuetify's inline-flex content");
  await page.addStyleTag({ content: VUETIFY_CHIP_CONTENT });
  for (const [index, testId] of unchanged.entries()) {
    const theirs = await chipGeometry(page.getByTestId(testId));
    const where = ({ chip, content, text }) => ({ chip, content, text });
    assert.deepEqual(where(ours[index]), where(theirs), `${testId} is drawn as with Vuetify's own chip content`);
  }
});
