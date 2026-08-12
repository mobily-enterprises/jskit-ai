import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { chromium, expect } from "@playwright/test";
import { runGeneratedAppSmokeCase } from "../../src/test/playwright.js";

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

function createSmokeDocument({ screenTargetHeight = 48, outsideTargetHeight = 16 } = {}) {
  return `data:text/html,${encodeURIComponent(`<!doctype html>
<html>
  <body>
    <button style="height: ${outsideTargetHeight}px">Ready</button>
    <main class="generated-ui-screen">
      <h1>Ready</h1>
      <button style="height: ${screenTargetHeight}px">
        Continue
        <span role="button" style="display: inline-block; height: 12px">Icon</span>
      </button>
    </main>
  </body>
</html>`)}`;
}

async function withPage(run) {
  const page = await browser.newPage();
  try {
    await run(page);
  } finally {
    await page.close();
  }
}

test("generated app smoke scopes text and compact tap targets to the generated screen", async () => {
  await withPage((page) => runGeneratedAppSmokeCase({
    page,
    expect,
    expectedText: "Ready",
    viewport: { name: "compact", width: 390, height: 844 },
    smokePath: createSmokeDocument()
  }));
});

test("generated app smoke rejects undersized compact tap targets", async () => {
  await withPage(async (page) => {
    await assert.rejects(
      runGeneratedAppSmokeCase({
        page,
        expect,
        expectedText: "Ready",
        viewport: { name: "compact", width: 390, height: 844 },
        smokePath: createSmokeDocument({ screenTargetHeight: 47 })
      }),
      /Expected: >= 48/u
    );
  });
});

test("generated app smoke permits denser controls outside compact layouts", async () => {
  await withPage((page) => runGeneratedAppSmokeCase({
    page,
    expect,
    expectedText: "Ready",
    viewport: { name: "expanded", width: 1280, height: 900 },
    smokePath: createSmokeDocument({ screenTargetHeight: 36 })
  }));
});
