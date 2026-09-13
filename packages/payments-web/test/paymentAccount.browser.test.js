import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

test("billing component supports responsive layout, keyboard actions and recoverable states", {
  skip: process.env.JSKIT_PAYMENTS_WEB_BROWSER_INTEGRATION !== "1", timeout: 120_000
}, async () => {
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/payment-account/", import.meta.url)) });
  let browser;
  try {
    browser = await chromium.launch(createChromiumLaunchOptions());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(runtime.baseURL);
    const billing = page.getByRole("region", { name: "Subscription and billing", exact: true });
    const choose = billing.getByRole("button", { name: "Choose Studio plan" });
    await expect(choose).toBeEnabled();
    for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 1000], [1440, 500]]) {
      await page.setViewportSize({ width, height });
      await expect(billing).toBeVisible();
      const layout = await billing.evaluate((element) => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        targets: Array.from(element.querySelectorAll("button")).map((button) => button.getBoundingClientRect().height),
        clipped: Array.from(element.querySelectorAll(".v-list-item-title, .v-list-item-subtitle, .v-btn__content")).some((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1)
      }));
      assert.ok(layout.overflow <= 1, `${width}: horizontal overflow`);
      assert.equal(layout.clipped, false, `${width}: clipped text`);
      assert.ok(layout.targets.every((height) => height >= 48), `${width}: small target`);
    }
    await choose.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.paymentFixture.events.pop()), { name: "checkout", value: "studio" });
    await billing.getByRole("button", { name: "Next billing page" }).click();
    assert.deepEqual(await page.evaluate(() => window.paymentFixture.events.pop()), { name: "history", value: { collection: "transactions", after: "next-1" } });
    await page.evaluate(() => { window.paymentFixture.state.pending = true; });
    await expect(choose).toBeDisabled();
    await expect(billing.getByRole("button", { name: "Manage billing" })).toBeDisabled();
    await page.evaluate(() => { Object.assign(window.paymentFixture.state, { pending: false, canManage: false }); });
    await expect(billing.getByText("A billing administrator can manage this account.")).toBeVisible();
    await expect(choose).toBeDisabled();
    await page.evaluate(() => { Object.assign(window.paymentFixture.state, { canManage: true, account: { balance: 0, features: [], hasCustomer: true, subscriptions: [{ id: "sub-1", planId: "studio", status: "past_due", periodEnd: 1800000000000 }] } }); });
    await expect(billing.getByText("Payment overdue", { exact: true })).toBeVisible();
    await expect(choose).toBeDisabled();
    await billing.getByRole("button", { name: "Manage billing" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.paymentFixture.events.pop().name), "portal");
    await page.evaluate(() => { window.paymentFixture.state.historyError = "History unavailable"; });
    await billing.getByRole("button", { name: "Retry billing history" }).click();
    assert.equal(await page.evaluate(() => window.paymentFixture.events.pop().name), "retry-history");
    await page.evaluate(() => { window.paymentFixture.state.canReadHistory = false; });
    await expect(billing.getByRole("region", { name: "Billing history" })).toHaveCount(0);
    await page.evaluate(() => { window.paymentFixture.state.loadError = "Billing unavailable"; });
    await expect(billing.getByRole("alert")).toHaveText(/Billing unavailable/);
    await billing.getByRole("button", { name: "Retry billing details" }).click();
    assert.equal(await page.evaluate(() => window.paymentFixture.events.pop().name), "refresh");
    await page.evaluate(() => { Object.assign(window.paymentFixture.state, { loadError: "", account: null, loading: true }); });
    await expect(billing).toHaveAttribute("aria-busy", "true");
    await expect(billing.locator(".v-skeleton-loader")).toBeVisible();
    await expect(billing.getByRole("button")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await stopProcess(runtime);
  }
});
