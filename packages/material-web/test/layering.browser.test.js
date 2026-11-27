import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const SKIP = process.env.JSKIT_MATERIAL_WEB_BROWSER === "1" ? false : "set JSKIT_MATERIAL_WEB_BROWSER=1";
const open = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("./fixtures/layering", import.meta.url)),
  configFile: "vite.config.js"
});

const CONTROLS = Object.freeze(["button", "chip", "list-item", "card", "avatar"]);

// material.css draws a control's state layers under its content, and the content parts it lifts above them must not
// become what an absolutely placed child is placed in: an attention dot at a 144px button's top right (Vibe64 Online's
// resource indicator) moved onto the 120px content inside it, over the readings it marks.
test("a mark placed absolutely in a button's, chip's, list item's, card's or avatar's content sits at the control's corner", {
  skip: SKIP,
  timeout: 120_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  t.after(() => page.close());
  await page.goto("/");
  await page.getByTestId("avatar-mark").waitFor({ state: "attached" });

  const placed = {};
  const corners = {};
  for (const control of CONTROLS) {
    // The top right corner of the control's padding box, inside its border, where top: 0 and right: 0 put a child the
    // control contains; and where the mark is drawn, to a tenth of a pixel.
    corners[control] = await page.getByTestId(control).evaluate((element) => {
      const box = element.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      return [round(box.top + element.clientTop), round(box.left + element.clientLeft + element.clientWidth)];
    });
    placed[control] = await page.getByTestId(`${control}-mark`).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [Math.round(box.top * 10) / 10, Math.round(box.right * 10) / 10];
    });
  }
  assert.deepEqual(placed, corners);
});
