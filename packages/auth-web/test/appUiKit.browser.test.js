import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "../../../tooling/testUtils/browserExpect.mjs";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// An application on Vuetify with its own design system keeps JSKIT's auth views and gives them its own button, dialog
// frame and type classes through shell-web's UI kit (provideShellUi): each screen draws the app's components, with the
// same behavior. The auth API is answered in the page; nothing reaches a provider.
const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const CAPABILITIES = {
  provider: { id: "local", label: "Local" },
  features: {
    password: { login: true, register: true, selfRegister: true },
    passwordRecovery: { request: true, complete: true },
    oauthLogin: { enabled: true, defaultProvider: "google", providers: [{ id: "google", label: "Google" }] },
    emailConfirmation: true,
    secondFactor: true
  }
};
const SIGNED_OUT = { authenticated: false, csrfToken: "fixture-csrf", authCapabilities: CAPABILITIES };
const SIGNED_IN = { ...SIGNED_OUT, authenticated: true, username: "Ada Lovelace", email: "ada@example.com", permissions: [] };
const SECOND_FACTOR_REQUIRED = {
  status: 403,
  json: { error: "Confirm it's you with a code from your authenticator app.", code: "auth.secondFactor.required", params: { maxAgeSeconds: 300 } }
};
const WRONG_CODE = {
  status: 400,
  json: { error: "That code is not right. Enter the code your authenticator app shows now.", code: "auth.local.secondFactor.codeInvalid", params: {} }
};
const KIT_TEXT = /\bkit-(?:title|heading|subheading|strong|lead|body|caption)\b/u;

const openFixture = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/app-ui-kit/", import.meta.url)) });

/**
 * A page of the app with the auth API behind it. `routes` answers "METHOD /path" with a list of answers, one per
 * request, the last repeated, or a function of the request's body; anything else under /api is a test failure.
 */
async function openApp(t, routes, { session = SIGNED_OUT } = {}) {
  const { vite, browser } = await openFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const api = { session, requests: [], unexpected: [], errors: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: api.session });
      return;
    }
    api.requests.push({ key, body: request.postDataJSON() });
    const answers = routes[key];
    if (!answers) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    const answer = typeof answers === "function" ? answers(request.postDataJSON()) : answers.length > 1 ? answers.shift() : answers[0];
    await route.fulfill(answer);
  });
  return api;
}

function bodiesOf(api, key) {
  return api.requests.filter((request) => request.key === key).map((request) => request.body);
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

/** The kit's button of that name (a link where the view gave it an href), with what the view asked of it. */
async function kitButton(scope, name, role = "button") {
  const button = scope.getByRole(role, { name, exact: true });
  await expect(button).toBeVisible();
  return button.evaluate((element) => ({
    kit: element.classList.contains("kit-button"),
    emphasis: element.dataset.emphasis,
    tone: element.dataset.tone,
    size: element.dataset.size,
    block: element.dataset.block === "true",
    icon: element.dataset.icon || ""
  }));
}

// Any Vuetify button on the screen, and any element with a Material type class, inside the auth card: none, but the
// Sign in and Register segmented button, a choice the kit leaves to Vuetify.
function materialLeftovers(page, scope) {
  return page.evaluate((selector) => [...document.querySelectorAll(`${selector} *`)]
    .filter((element) => (element.classList.contains("v-btn") && !element.classList.contains("mode-switch__segment")) ||
      [...element.classList].some((name) => /^text-(?:display|headline|title|body|label)-/u.test(name)))
    .map((element) => element.outerHTML.slice(0, 100)), scope);
}

test("sign-in and registration draw the app's buttons and type through the kit, and register to the confirm-your-email step", options, async (t) => {
  const api = await openApp(t, {
    "POST /api/login": [{ status: 401, json: { error: "Invalid email or password." } }],
    "POST /api/register": [{ json: { requiresEmailConfirmation: true, username: "Ada" } }],
    "POST /api/register/confirmation/resend": [{ json: { ok: true } }]
  });
  const { page } = api;
  await page.goto("/auth/login?returnTo=%2Fhome");

  const title = page.getByRole("heading", { level: 1, name: "Sign in" });
  await expect(title).toHaveClass(/\bauth-title\b/u);
  await expect(title).toHaveClass(KIT_TEXT);
  assert.deepEqual(await kitButton(page, "Sign in"), { kit: true, emphasis: "high", tone: "accent", size: "large", block: true, icon: "" });
  assert.deepEqual(await kitButton(page, "Continue with Google"), {
    kit: true, emphasis: "subtle", tone: "neutral", size: "default", block: true, icon: "$google"
  });
  assert.deepEqual(await kitButton(page, "Forgot password?"), { kit: true, emphasis: "low", tone: "neutral", size: "default", block: false, icon: "" });
  assert.deepEqual(await materialLeftovers(page, ".auth-card"), []);

  // A refused sign-in is the same refusal through the app's button.
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.authFixture.reports.at(-1)?.message)).toBe("Invalid email or password.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();

  // Registering, end to end: the mode, a field error on blur, the request with the invitation-free body, and the
  // confirm-your-email step with its own actions.
  await page.getByRole("radio", { name: "Register" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("Correct-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).fill("Different-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).blur();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Register", exact: true })).toBeDisabled();
  await page.getByLabel("Confirm password", { exact: true }).fill("Correct-horse-1");
  assert.deepEqual(await kitButton(page, "Register"), { kit: true, emphasis: "high", tone: "accent", size: "large", block: true, icon: "" });
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Confirm your email" })).toBeVisible();
  assert.deepEqual(bodiesOf(api, "POST /api/register"), [{ email: "ada@example.com", password: "Correct-horse-1" }]);
  assert.deepEqual(await kitButton(page, "Go to main screen"), { kit: true, emphasis: "medium", tone: "accent", size: "default", block: false, icon: "" });
  assert.deepEqual(await kitButton(page, "Resend confirmation email"), {
    kit: true, emphasis: "subtle", tone: "neutral", size: "default", block: false, icon: ""
  });
  assert.deepEqual(await kitButton(page, "Back to sign in"), { kit: true, emphasis: "low", tone: "neutral", size: "default", block: false, icon: "" });
  assert.deepEqual(await materialLeftovers(page, ".auth-card"), []);
  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  await expect.poll(() => bodiesOf(api, "POST /api/register/confirmation/resend")).toEqual([{ email: "ada@example.com" }]);
  await finish(api);
});

test("reset password, email change and sign-out draw the app's title and buttons through the kit", options, async (t) => {
  const api = await openApp(t, { "POST /api/logout": [{ status: 500, json: { error: "Sign-out failed on the server." } }] }, { session: SIGNED_IN });
  const { page } = api;

  await page.goto("/auth/email-change");
  await expect(page.getByRole("heading", { level: 1, name: "Confirm your new email" })).toHaveClass(KIT_TEXT);
  assert.deepEqual(await kitButton(page, "Continue", "link"), { kit: true, emphasis: "low", tone: "neutral", size: "default", block: false, icon: "" });
  assert.deepEqual(await materialLeftovers(page, ".email-change-card"), []);

  await page.goto("/auth/signout");
  await expect(page.getByRole("heading", { level: 1, name: "Signing you out" })).toHaveClass(KIT_TEXT);
  assert.deepEqual(await kitButton(page, "Retry sign out"), { kit: true, emphasis: "high", tone: "accent", size: "default", block: false, icon: "" });
  assert.deepEqual(await kitButton(page, "Go to login"), { kit: true, emphasis: "low", tone: "neutral", size: "default", block: false, icon: "" });
  assert.deepEqual(await materialLeftovers(page, ".signout-card"), []);
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await expect.poll(() => bodiesOf(api, "POST /api/logout").length).toBe(2);

  await page.goto("/auth/reset-password");
  await expect(page.getByRole("heading", { level: 1, name: "Reset password" })).toHaveClass(KIT_TEXT);
  assert.deepEqual(await materialLeftovers(page, ".reset-card"), []);
  await finish(api);
});

test("the step-up dialog is the app's frame, its title in the head and Confirm in the foot, and runs the request again after a code", options, async (t) => {
  const api = await openApp(t, {
    "POST /api/console/refund": [SECOND_FACTOR_REQUIRED, { json: { refunded: true } }, SECOND_FACTOR_REQUIRED],
    "POST /api/second-factor/verify": [WRONG_CODE, { json: { verifiedAt: "2026-11-26T10:00:00.000Z", method: "code", recoveryCodesLeft: 10 } }]
  }, { session: SIGNED_IN });
  const { page } = api;
  await page.goto("/console");
  await page.getByRole("button", { name: "Refund" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toHaveClass(/\bkit-dialog\b/u);
  await expect(dialog.locator(".kit-dialog__head").getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  const foot = dialog.locator(".kit-dialog__actions");
  assert.deepEqual(await kitButton(foot, "Confirm"), { kit: true, emphasis: "high", tone: "accent", size: "default", block: false, icon: "" });
  assert.deepEqual(await kitButton(foot, "Cancel"), { kit: true, emphasis: "low", tone: "accent", size: "default", block: false, icon: "" });
  assert.deepEqual(await kitButton(dialog.locator(".kit-dialog__body"), "Use a recovery code"), {
    kit: true, emphasis: "low", tone: "accent", size: "default", block: false, icon: ""
  });
  await expect(dialog.locator(".kit-dialog__body")).toHaveText(/Enter the code your authenticator app shows now\./u);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".v-overlay, .v-dialog, .v-card")].length), 0);

  // Enter in the field submits through the foot's Confirm; a wrong code is refused beside the field.
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("That code is not right. Enter the code your authenticator app shows now.")).toBeVisible();
  await dialog.getByLabel("6-digit code").fill("123456");
  await foot.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("console-outcome")).toHaveText("Refunded");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Refund" })).toBeFocused();

  // The frame's own close (Escape here) cancels the request, and focus is back on the control that sent it.
  await page.getByRole("button", { name: "Refund" }).click();
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("console-outcome")).toHaveText("Refund failed: Confirm it's you with a code from your authenticator app.");
  await expect(page.getByRole("button", { name: "Refund" })).toBeFocused();

  assert.equal(bodiesOf(api, "POST /api/console/refund").length, 3);
  assert.deepEqual(bodiesOf(api, "POST /api/second-factor/verify"), [{ code: "000000" }, { code: "123456" }]);
  await finish(api);
});

test("the authenticator settings draw the app's buttons and type through the kit, Remove in the danger tone", options, async (t) => {
  const api = await openApp(t, {
    "GET /api/second-factor": [{ json: { enrolled: true, enrolledAt: "2026-11-13T10:00:00.000Z", recoveryCodesLeft: 10, verifiedAt: null } }]
  }, { session: SIGNED_IN });
  const { page } = api;
  await page.goto("/account/second-factor");
  await expect(page.getByText(/^Authenticator app set up on /u)).toHaveClass(KIT_TEXT);
  assert.deepEqual(await kitButton(page, "Remove authenticator"), { kit: true, emphasis: "low", tone: "danger", size: "default", block: false, icon: "" });
  assert.deepEqual(await kitButton(page, "New recovery codes"), { kit: true, emphasis: "medium", tone: "accent", size: "default", block: false, icon: "" });
  await page.getByRole("button", { name: "Remove authenticator" }).click();
  assert.deepEqual(await kitButton(page, "Remove authenticator"), { kit: true, emphasis: "high", tone: "danger", size: "default", block: false, icon: "" });
  assert.deepEqual(await materialLeftovers(page, ".second-factor-settings"), []);
  await finish(api);
});
