import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

test("the shared element renders delayed sends and supplies retry, edit and cancel without application handlers", {
  skip: process.env.JSKIT_ASSISTANT_CORE_BROWSER_INTEGRATION !== "1", timeout: 90_000
}, async () => {
  const vite = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/responsive-assistant", import.meta.url)) });
  const browser = await chromium.launch(createChromiumLaunchOptions());
  try {
    for (const width of [390, 800, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${vite.baseURL}/?delivery=1`);
      const input = page.getByRole("textbox", { name: "Message AI assistant" });
      const send = async text => {
        await input.fill(text);
        await page.getByRole("button", { name: "Send message", exact: true }).click();
      };
      const fail = () => page.getByRole("button", { name: "Fail request" }).click();
      await send("Explain this work.");
      await expect(page.getByText("Explain this work.", { exact: true })).toHaveCount(1);
      await expect(page.getByText("Start a conversation.", { exact: true })).toHaveCount(0);
      await expect(page.locator(".assistant-composer-support__assistant-status")).toHaveText("Sending to assistant…");
      await fail();
      await expect(page.getByText("Delivery unavailable.", { exact: true })).toHaveCount(1);
      await input.fill("Keep my newer draft.");
      await page.getByRole("button", { name: "Prepare newer input" }).click();
      await page.getByRole("button", { name: "Resend", exact: true }).click();
      await expect(input).toHaveValue("Keep my newer draft.");
      await page.getByRole("button", { name: "Accept request" }).click();
      await expect(page.getByText("Accepted once.", { exact: true })).toBeVisible();
      await expect(page.getByText("Explain this work.", { exact: true })).toHaveCount(1);
      const requests = JSON.parse(await page.locator("[data-requests]").textContent());
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.deepEqual(requests[0].configuration, { tone: "concise" });
      assert.deepEqual(requests[0].attachmentIds, ["original-file"]);
      await expect(page.locator("[data-files]")).toHaveText("new-file");
      await expect(page.locator("[data-cleared]")).toHaveText("original-file");
      await send("Edit this question.");
      await fail();
      await input.fill("Another draft.");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(input).toHaveValue("Edit this question.\n\nAnother draft.");
      await expect(input).toBeFocused();
      await send("Cancel this question.");
      await fail();
      await input.fill("Retain this.");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(input).toHaveValue("Retain this.");
      await expect(page.getByText("Cancel this question.", { exact: true })).toHaveCount(0);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});
