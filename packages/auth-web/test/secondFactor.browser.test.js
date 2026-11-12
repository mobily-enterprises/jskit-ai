import assert from "node:assert/strict";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const PHONE = { width: 390, height: 844 };
const SESSION = {
  authenticated: true,
  csrfToken: "fixture-csrf",
  username: "Ada Lovelace",
  email: "ada@example.com",
  permissions: [],
  authCapabilities: { provider: { id: "local", label: "Local" }, features: { secondFactor: true } }
};
const NOT_ENROLLED = { enrolled: false, enrolledAt: null, recoveryCodesLeft: 0, verifiedAt: null };
const ENROLLED = {
  enrolled: true,
  enrolledAt: "2026-11-13T10:00:00.000Z",
  recoveryCodesLeft: 10,
  verifiedAt: "2026-11-13T10:00:00.000Z"
};
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RECOVERY_CODES = Array.from({ length: 10 }, (_, index) => `abcd${index}-efgh${index}`);
const REQUIRED = {
  status: 403,
  json: { error: "Confirm it's you with a code from your authenticator app.", code: "auth.secondFactor.required", params: { maxAgeSeconds: 300 } }
};

let runtime = null;
let browser = null;

before(async () => {
  if (!RUN) return;
  runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/sign-in/", import.meta.url)) });
  browser = await chromium.launch(createChromiumLaunchOptions());
});

after(async () => {
  await browser?.close();
  await stopProcess(runtime);
});

function refused(status, code, message) {
  return { status, json: { error: message, code, params: {} } };
}

/**
 * A signed-in phone with the second-factor API behind it. `routes` answers "METHOD /path" with a list of answers, one
 * per request, the last repeated; anything else under /api is a test failure.
 */
async function openApp(routes) {
  const page = await browser.newPage({ baseURL: runtime.baseURL, viewport: PHONE });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const api = { requests: [], unexpected: [], errors: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: SESSION });
      return;
    }
    api.requests.push({ key, body: request.postDataJSON() });
    const answers = routes[key];
    if (!answers) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    await route.fulfill(answers.length > 1 ? answers.shift() : answers[0]);
  });
  return api;
}

function bodiesOf(api, key) {
  return api.requests.filter((request) => request.key === key).map((request) => request.body);
}

function reports(page) {
  return page.evaluate(() => window.authFixture.reports.map(({ message, severity, channel }) => ({ message, severity, channel })));
}

async function fitsTheScreen(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "nothing scrolls sideways");
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

test("on a phone, setting up an authenticator shows its QR code and key, a wrong code beside the field, and the recovery codes once", options, async () => {
  const api = await openApp({
    "GET /api/second-factor": [refused(503, "", "Service unavailable."), { json: NOT_ENROLLED }, { json: ENROLLED }],
    "POST /api/second-factor/setup": [{
      json: { secret: SECRET, otpauthUrl: `otpauth://totp/Console:ada%40example.com?secret=${SECRET}&issuer=Console`, issuer: "Console", accountName: "ada@example.com" }
    }],
    "POST /api/second-factor/setup/confirm": [
      refused(400, "auth.local.secondFactor.codeInvalid", "That code is not right. Enter the code your authenticator app shows now."),
      { json: { recoveryCodes: RECOVERY_CODES, verifiedAt: "2026-11-13T10:00:00.000Z" } }
    ]
  });
  const { page } = api;
  await page.goto("/account/second-factor");

  // A state that cannot load says so in the page, with a way to try again.
  await expect(page.getByText("Could not load your authenticator settings.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No authenticator app is set up.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: "QR code to add ada@example.com to an authenticator app" })).toBeVisible();
  await expect(page.getByText("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ")).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await expect(page.getByRole("button", { name: "Use a recovery code" })).toHaveCount(0);
  await fitsTheScreen(page);

  // The keyboard alone confirms: a wrong code is refused beside the field and stays there to be corrected.
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(page.getByText("That code is not right. Enter the code your authenticator app shows now.")).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toHaveValue("000000");
  await page.getByLabel("6-digit code").fill("123456");
  await page.keyboard.press("Enter");

  const codesTitle = page.getByRole("heading", { name: "Save your recovery codes" });
  await expect(codesTitle).toBeFocused();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveText(RECOVERY_CODES);
  await fitsTheScreen(page);
  await page.getByRole("button", { name: "I've saved them" }).click();
  await expect(page.getByText(/^Authenticator app set up on /u)).toBeFocused();
  await expect(page.getByText("10 recovery codes left.")).toBeVisible();
  await expect(page.getByText(RECOVERY_CODES[0])).toHaveCount(0);

  assert.deepEqual(bodiesOf(api, "POST /api/second-factor/setup/confirm"), [{ code: "000000" }, { code: "123456" }]);
  assert.deepEqual(await reports(page), []);
  await finish(api);
});

test("removing the authenticator takes a code or a recovery code, shows a wait beside the field and reports a failed request", options, async () => {
  const api = await openApp({
    "GET /api/second-factor": [{ json: { ...ENROLLED, recoveryCodesLeft: 0 } }, { json: NOT_ENROLLED }],
    "DELETE /api/second-factor": [
      refused(429, "auth.local.secondFactor.locked", "Too many wrong codes. Try again in 1 minute."),
      { status: 500, json: { error: "Internal server error." } },
      { json: { ok: true } }
    ]
  });
  const { page } = api;
  await page.goto("/account/second-factor");
  await expect(page.getByText("No recovery codes left: create new ones.")).toBeVisible();

  // Cancel goes back to the state, where the keyboard carries on.
  await page.getByRole("button", { name: "Remove authenticator" }).click();
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/^Authenticator app set up on /u)).toBeFocused();

  await page.getByRole("button", { name: "Remove authenticator" }).click();
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await expect(page.getByLabel("Recovery code")).toBeFocused();
  await page.keyboard.type("abcd0-efgh0");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Too many wrong codes. Try again in 1 minute.")).toBeVisible();
  assert.deepEqual(await reports(page), []);

  await page.getByRole("button", { name: "Remove authenticator" }).click();
  await expect.poll(() => reports(page)).toEqual([{ message: "Internal server error.", severity: "error", channel: "snackbar" }]);
  await expect(page.getByLabel("Recovery code")).toHaveValue("abcd0-efgh0");

  await page.getByRole("button", { name: "Remove authenticator" }).click();
  await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();
  assert.deepEqual((await reports(page)).at(-1), { message: "Authenticator removed.", severity: "success", channel: "snackbar" });
  assert.deepEqual(bodiesOf(api, "DELETE /api/second-factor"), Array(3).fill({ recoveryCode: "abcd0-efgh0" }));
  await fitsTheScreen(page);
  await finish(api);
});

test("a route that asks for a fresh code opens the step-up dialog, runs again after the code, and Escape cancels it", options, async () => {
  const api = await openApp({
    "POST /api/console/refund": [REQUIRED, { json: { refunded: true } }, REQUIRED],
    "POST /api/second-factor/verify": [
      refused(400, "auth.local.secondFactor.codeInvalid", "That code is not right. Enter the code your authenticator app shows now."),
      { json: { verifiedAt: "2026-11-13T10:00:00.000Z", method: "code", recoveryCodesLeft: 10 } }
    ]
  });
  const { page } = api;
  await page.goto("/console");
  await page.getByRole("button", { name: "Refund" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  await fitsTheScreen(page);
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("That code is not right. Enter the code your authenticator app shows now.")).toBeVisible();
  await dialog.getByLabel("6-digit code").fill("123456");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("console-outcome")).toHaveText("Refunded");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Refund" }).click();
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("console-outcome")).toHaveText("Refund failed: Confirm it's you with a code from your authenticator app.");

  assert.equal(bodiesOf(api, "POST /api/console/refund").length, 3);
  assert.deepEqual(bodiesOf(api, "POST /api/second-factor/verify"), [{ code: "000000" }, { code: "123456" }]);
  assert.deepEqual(await reports(page), []);
  await finish(api);
});
