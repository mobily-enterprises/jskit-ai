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
      await expect(page.getByText("Failed: Delivery unavailable.", { exact: true })).toHaveCount(1);
      await input.fill("Keep my newer draft.");
      await page.getByRole("button", { name: "Prepare newer input" }).click();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
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
      await page.goto(`${vite.baseURL}/?delivery=1&queue=1`);
      await send("First steer.");
      await send("Second steer.");
      await send("Third steer.");
      await expect(input).toHaveValue("");
      await expect(page.getByText("Pending", { exact: true })).toHaveCount(3);
      await expect(page.locator(".assistant-transcript__message--pending")).toHaveCount(3);
      assert.equal(JSON.parse(await page.locator("[data-requests]").textContent()).length, 1);
      await input.fill("Keep this newer draft.");
      await fail();
      await expect(page.locator(".assistant-transcript__message--failed")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      if (width === 390) {
        const retryBox = await page.getByRole("button", { name: "Retry", exact: true }).boundingBox();
        assert.ok(retryBox.width >= 48 && retryBox.height >= 48);
      }
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByText("Pending", { exact: true })).toHaveCount(3);
      for (let count = 2; count <= 4; count += 1) {
        await expect.poll(async () => JSON.parse(await page.locator("[data-requests]").textContent()).length).toBe(count);
        await page.getByRole("button", { name: "Accept request" }).click();
      }
      await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);
      await expect(page.locator(".assistant-transcript__message--pending")).toHaveCount(0);
      await expect(input).toHaveValue("Keep this newer draft.");
      const queuedRequests = JSON.parse(await page.locator("[data-requests]").textContent());
      assert.deepEqual(queuedRequests.map(item => item.message), ["First steer.", "Second steer.", "Third steer.", "First steer."]);
      assert.deepEqual(queuedRequests[0], queuedRequests[3]);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser.close();
    await stopProcess(vite);
  }
});
