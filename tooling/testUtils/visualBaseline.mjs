import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Material 3 visual baselines: each screen's computed styles (exact sizes, corners, colour roles and type) and its
// screenshot, both committed under tooling/material-baselines/<package>. A change that drifts a default away from them
// fails `npm run test:material-baselines` (and CI) until someone reviews it and accepts it with
// `npm run material-baselines:accept`, which rewrites them (JSKIT_UPDATE_VISUAL_BASELINES=1).
// JSKIT_VISUAL_GALLERY_DIR also saves every screenshot there, for review.
const UPDATE_BASELINES = process.env.JSKIT_UPDATE_VISUAL_BASELINES === "1";
const GALLERY_DIRECTORY = process.env.JSKIT_VISUAL_GALLERY_DIR || "";
// A pixel differs when a channel moves more than this; anti-aliasing between machines stays below it.
const CHANNEL_TOLERANCE = 48;
// The share of pixels that may differ, for text rendered on another machine.
const PIXEL_RATIO_TOLERANCE = 0.01;
const STYLE_PROPERTIES = Object.freeze([
  "backgroundColor",
  "color",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderTopWidth",
  "borderTopColor",
  "boxShadow",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "paddingInlineStart"
]);

/**
 * The computed styles of each probe's first visible match, or null when nothing matches. Widths are recorded only for
 * probes that ask for them, since text widths vary with the machine's font rendering.
 * @param {import("playwright").Page} page
 * @param {Array<{ name: string, selector: string, width?: boolean }>} probes
 */
async function readMaterialStyles(page, probes) {
  return page.evaluate(({ probes: entries, properties }) => {
    const snapshot = {};
    for (const { name, selector, width } of entries) {
      const element = [...document.querySelectorAll(selector)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!element) {
        snapshot[name] = null;
        continue;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const entry = { height: Math.round(rect.height) };
      if (width) {
        entry.width = Math.round(rect.width);
      }
      for (const property of properties) {
        entry[property] = style[property];
      }
      snapshot[name] = entry;
    }
    return snapshot;
  }, { probes, properties: STYLE_PROPERTIES });
}

/**
 * The share of pixels that differ between two same-size PNG screenshots, compared in the page's own canvas.
 * @param {import("playwright").Page} page
 * @param {Buffer} actual
 * @param {Buffer} expected
 */
async function comparePixels(page, actual, expected) {
  return page.evaluate(async ({ actualPng, expectedPng, tolerance }) => {
    async function pixels(base64) {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    }
    const [current, baseline] = await Promise.all([pixels(actualPng), pixels(expectedPng)]);
    if (current.width !== baseline.width || current.height !== baseline.height) {
      return { sizeMismatch: `${current.width}x${current.height} instead of ${baseline.width}x${baseline.height}`, ratio: 1 };
    }
    let different = 0;
    for (let index = 0; index < current.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        if (Math.abs(current.data[index + channel] - baseline.data[index + channel]) > tolerance) {
          different += 1;
          break;
        }
      }
    }
    return { sizeMismatch: "", ratio: different / (current.width * current.height) };
  }, { actualPng: actual.toString("base64"), expectedPng: expected.toString("base64"), tolerance: CHANNEL_TOLERANCE });
}

/**
 * Waits until the page has stopped moving: its fonts are loaded and, for several frames in a row, no finite animation
 * (a CSS transition or animation, or a Web Animation such as an overlay's enter) is running. A Vue transition starts on
 * the second frame after its element appears, so a few quiet frames are needed, not one. An infinite animation, such
 * as a progress spinner, never finishes and is ignored. A page that keeps starting new animations is read after two
 * seconds, and its baseline comparison decides.
 * @param {import("playwright").Page} page
 */
async function waitForStillPage(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const moving = () => document.getAnimations().some((animation) =>
      animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const deadline = performance.now() + 2_000;
    for (let quietFrames = 0; quietFrames < 4 && performance.now() < deadline;) {
      await frame();
      quietFrames = moving() ? 0 : quietFrames + 1;
    }
  });
}

/**
 * Checks the current page against its committed Material 3 baseline, or writes the baseline when accepting changes.
 * @param {import("playwright").Page} page
 * @param {{ directory: string, name: string, probes: Array<{ name: string, selector: string, width?: boolean }> }} options
 */
async function expectMaterialBaseline(page, { directory, name, probes }) {
  await waitForStillPage(page);
  const styles = await readMaterialStyles(page, probes);
  const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
  const stylePath = path.join(directory, `${name}.json`);
  const imagePath = path.join(directory, `${name}.png`);
  if (GALLERY_DIRECTORY) {
    await mkdir(GALLERY_DIRECTORY, { recursive: true });
    await writeFile(path.join(GALLERY_DIRECTORY, `${name}.png`), screenshot);
  }
  if (UPDATE_BASELINES) {
    await mkdir(directory, { recursive: true });
    await writeFile(stylePath, `${JSON.stringify(styles, null, 2)}\n`);
    await writeFile(imagePath, screenshot);
    return;
  }
  const expectedStyles = JSON.parse(await readFile(stylePath, "utf8"));
  assert.deepEqual(
    styles,
    expectedStyles,
    `${name} drifted from its Material 3 baseline; review it, then accept it with npm run material-baselines:accept.`
  );
  const { sizeMismatch, ratio } = await comparePixels(page, screenshot, await readFile(imagePath));
  assert.equal(sizeMismatch, "", `${name}'s screenshot is ${sizeMismatch}.`);
  assert.ok(
    ratio <= PIXEL_RATIO_TOLERANCE,
    `${name} looks ${(ratio * 100).toFixed(2)}% different from its baseline screenshot; review it, then accept it with npm run material-baselines:accept.`
  );
}

export { expectMaterialBaseline, readMaterialStyles };
