import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  reservePort,
  startCapturedProcess,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";

const execFileAsync = promisify(execFile);
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(TEST_DIRECTORY, "../fixtures/production-build");
const VITE_CLI = path.resolve(TEST_DIRECTORY, "../../../node_modules/vite/bin/vite.js");
const RUN_BROWSER_TEST = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1";
// The controls Vuetify's reset (button, input, select, textarea { font: inherit }) would restyle if it came after
// Vuetify's component styles.
const CONTROLS = Object.freeze({
  button: "[data-testid=button-control]",
  link: "[data-testid=link-control]",
  input: "[data-testid=input-control] input",
  textarea: "[data-testid=textarea-control] textarea",
  select: "[data-testid=select-control] input:not([type=hidden])"
});

// Buttons whose state layer (Vuetify's overlay and underlay) must take the button's own shape, round or full.
const STATE_LAYERS = Object.freeze({
  iconButton: "[data-testid=icon-control]",
  avatarButton: "[data-testid=avatar-control]",
  disabledButton: "[data-testid=disabled-control]"
});

async function readControls(page) {
  await page.locator(CONTROLS.select).waitFor({ state: "attached" });
  return page.evaluate(({ controls, stateLayers }) => {
    const type = Object.entries(controls).map(([name, selector]) => {
      const style = window.getComputedStyle(document.querySelector(selector));
      const { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } = style;
      return [name, { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight }];
    });
    const shapes = Object.entries(stateLayers).map(([name, selector]) => {
      const button = document.querySelector(selector);
      const radius = (node) => window.getComputedStyle(node).borderTopLeftRadius;
      return [name, {
        button: radius(button),
        overlay: radius(button.querySelector(".v-btn__overlay")),
        underlay: radius(button.querySelector(".v-btn__underlay"))
      }];
    });
    return Object.fromEntries([...type, ...shapes]);
  }, { controls: CONTROLS, stateLayers: STATE_LAYERS });
}

// A production build links its shared component chunks' stylesheets before the entry's (the fixture's page links one
// such stylesheet first), which named vuetify-components before vuetify-core: every <button> v-btn lost
// label-large. The page JSKIT's Vite plugin builds names Vuetify's layer order first.
test("a production build styles buttons and fields as development does, with label-large on every button", {
  skip: RUN_BROWSER_TEST ? false : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1",
  timeout: 180_000
}, async (t) => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "shell-web-production-build-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const config = path.join(FIXTURE_ROOT, "vite.config.mjs");
  await execFileAsync(process.execPath, [VITE_CLI, "build", "--config", config, "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: FIXTURE_ROOT
  });
  const port = await reservePort();
  const preview = startCapturedProcess(process.execPath, [
    VITE_CLI, "preview", "--config", config, "--outDir", outDir, "--port", String(port), "--strictPort"
  ], { cwd: FIXTURE_ROOT });
  // Stopped in after hooks, which run when the test fails or times out too (a body's `finally` doesn't after a timeout).
  t.after(() => stopProcess(preview));
  await preview.waitFor(new RegExp(`http://127\\.0\\.0\\.1:${port}/`, "u"));
  const dev = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  t.after(() => stopProcess(dev));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const built = await readControls(page);
  assert.deepEqual([built.button.fontSize, built.button.fontWeight], ["14px", "500"], "a <button> v-btn is label-large");
  assert.deepEqual(built.link, built.button, "an <a> v-btn and a <button> one look alike");
  for (const name of Object.keys(STATE_LAYERS)) {
    const { button, overlay, underlay } = built[name];
    assert.notEqual(button, "0px", `${name} has its shape`);
    assert.deepEqual({ overlay, underlay }, { overlay: button, underlay: button }, `${name}'s state layer takes its shape`);
  }
  await page.goto(dev.baseURL);
  assert.deepEqual(built, await readControls(page), "every control styles as in development");
});
