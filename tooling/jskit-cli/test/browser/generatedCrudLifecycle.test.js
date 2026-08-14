import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  createChromiumLaunchOptions,
  startViteFixture,
  stopProcess
} from "../../../testUtils/browserFixture.mjs";
import { runGeneratedAppSmokeCase } from "../../src/test/playwright.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(TEST_DIRECTORY, "fixtures", "generated-crud-lifecycle");

test("generated compact CRUD supports empty, create, view, edit, and confirmed delete", {
  timeout: 180_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  let browser = null;

  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const context = await browser.newContext({
      baseURL: vite.baseURL,
      locale: "en-US"
    });
    const page = await context.newPage();

    await runGeneratedAppSmokeCase({
      page,
      expect,
      expectedText: "No books yet",
      viewport: { name: "compact", width: 390, height: 844 },
      smokePath: "/books"
    });

    const emptyStateAction = page.getByRole("link", { name: "New Book", exact: true });
    const emptyStateActionBox = await emptyStateAction.boundingBox();
    assert.ok(emptyStateActionBox && emptyStateActionBox.height >= 48);

    await emptyStateAction.click();
    await expect(page).toHaveURL(/\/books\/new$/u);
    await page.getByLabel("Title", { exact: true }).fill("First Book");
    await page.getByRole("button", { name: "Save Book", exact: true }).click();
    await expect(page).toHaveURL(/\/books\/1$/u);
    await expect(page.getByRole("heading", { name: "First Book", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page).toHaveURL(/\/books\/1\/edit$/u);
    const titleInput = page.getByLabel("Title", { exact: true });
    await expect(titleInput).toHaveValue("First Book");
    await titleInput.fill("Revised Book");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page).toHaveURL(/\/books\/1$/u);
    await expect(page.getByRole("heading", { name: "Revised Book", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Delete Book", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete Book?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page).toHaveURL(/\/books$/u);
    await expect(page.getByTestId("delete-request-count")).toHaveText("1");
    await expect(page.getByRole("heading", { name: "No books yet" })).toBeVisible();

    await context.close();
  } finally {
    await browser?.close();
    await stopProcess(vite);
  }
});
