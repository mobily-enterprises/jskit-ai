import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const FIELDS = Object.freeze(["Service", "Retired service", "Extras"]);

function field(page, label) {
  return page.locator(".v-input").filter({ has: page.getByText(label, { exact: true }) });
}

async function readModels(page) {
  return JSON.parse(await page.getByTestId("select-field-models").textContent());
}

async function assertNoStoredIdShown(page) {
  for (const label of FIELDS) {
    const words = (await field(page, label).innerText()).split(/\s+/u);
    assert.ok(!words.some((word) => /^\d+$/u.test(word)), `${label} shows a stored id: ${words.join(" ")}`);
  }
}

test("SelectField never shows a stored id while options load and titles unmatched values afterwards", {
  skip: process.env.JSKIT_HTTP_WEB_SELECT_FIELD_BROWSER === "1"
    ? false
    : "set JSKIT_HTTP_WEB_SELECT_FIELD_BROWSER=1 to run the select field browser regression",
  timeout: 120_000
}, async () => {
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/select-field/", import.meta.url)) });
  let browser = null;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage({ baseURL: runtime.baseURL });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/", { waitUntil: "networkidle" });

    // Options are still loading: unresolved values are hidden and the fields show their loading state.
    await expect(field(page, "Extras")).toContainText("Bath");
    await assertNoStoredIdShown(page);
    for (const label of FIELDS) {
      await expect(field(page, label).locator(".v-field--loading")).toHaveCount(1);
    }

    // Removing the visible chip keeps the value hidden while its options load.
    await field(page, "Extras").locator(".v-chip__close").click();
    assert.deepEqual(await readModels(page), { service: 53, retired: 99, serviceIds: [53] });

    await page.evaluate(() => window.releaseOptions());
    await expect(field(page, "Service")).toContainText("Daycare - One Day");
    await expect(field(page, "Retired service")).toContainText("Unavailable option");
    await expect(field(page, "Extras")).toContainText("Daycare - One Day");
    await expect(page.locator(".v-field--loading")).toHaveCount(0);
    await assertNoStoredIdShown(page);
    assert.deepEqual(await readModels(page), { service: 53, retired: 99, serviceIds: [53] });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await stopProcess(runtime);
  }
});
