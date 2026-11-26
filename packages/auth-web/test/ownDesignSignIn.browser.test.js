import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "../../../tooling/testUtils/browserExpect.mjs";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// The own-design-sign-in pattern in an app without Vuetify: its plain HTML sign-in view and second-factor prompt, on
// auth-web's public composables, do what DefaultLoginView and SecondFactorDialog do. The auth API is answered in the
// page; nothing reaches a provider.
const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const CAPABILITIES = {
  provider: { id: "local", label: "Local" },
  features: {
    password: { login: true, register: true, selfRegister: true },
    passwordRecovery: { request: true, complete: true },
    oauthLogin: { enabled: true, defaultProvider: "google", providers: [{ id: "google", label: "Google" }] },
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

const openFixture = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/own-design-sign-in/", import.meta.url)) });

/**
 * A page of the app with the auth API behind it. `routes` answers "METHOD /path" with a list of answers, one per
 * request, the last repeated, or a function of the request's body; anything else under /api is a test failure.
 */
async function openApp(t, routes) {
  const { vite, browser } = await openFixture(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const api = { session: SIGNED_OUT, requests: [], unexpected: [], errors: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: api.session });
      return;
    }
    api.requests.push({ key, body: request.postDataJSON(), csrf: request.headers()["csrf-token"] });
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

// Any element on the page that Vuetify drew or styled: its components and classes all start with "v-".
function vuetifyElements(page) {
  return page.evaluate(() => [...document.querySelectorAll("*")]
    .filter((element) => element.tagName.startsWith("V-") || [...element.classList].some((name) => name.startsWith("v-")))
    .map((element) => element.outerHTML.slice(0, 80)));
}

async function signIn(page, email, password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("an app's own sign-in screen without Vuetify signs in with a password, shows a refusal beside the form, lands on returnTo and asks for the second factor in its own prompt", options, async (t) => {
  const api = await openApp(t, {
    "POST /api/login": (body) => {
      if (body.password !== "correct horse") {
        return { status: 401, json: { error: "Invalid email or password." } };
      }
      api.session = SIGNED_IN;
      return { json: { ok: true, username: "Ada Lovelace" } };
    },
    "POST /api/console/refund": [SECOND_FACTOR_REQUIRED, { json: { refunded: true } }],
    "POST /api/second-factor/verify": [WRONG_CODE, { json: { verifiedAt: "2026-11-26T10:00:00.000Z", method: "code", recoveryCodesLeft: 10 } }]
  });
  const { page } = api;
  await page.goto("/auth/login?returnTo=%2Fconsole");

  // The app's own screen: its brand, its h1, its accent on the primary button, the provider the session offers, and
  // nothing Vuetify drew.
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("app-brand")).toHaveText("Reading Room");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Register" })).toHaveAttribute("aria-checked", "false");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  assert.equal(await submit.evaluate((button) => getComputedStyle(button).backgroundColor), "rgb(164, 56, 15)");
  assert.deepEqual(await vuetifyElements(page), []);

  // A field error on blur, in the field's own line.
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Email").blur();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();

  // A refused sign-in shows the server's message beside the form, which stays filled in and usable.
  await signIn(page, "Ada@Example.com", "wrong password");
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page.getByLabel("Email")).toHaveValue("Ada@Example.com");
  await expect(submit).toBeEnabled();
  assert.deepEqual(
    (await page.evaluate(() => window.authFixture.reports)).map(({ source, message, channel }) => ({ source, message, channel })),
    [{ source: "auth-web.default-login-view", message: "Invalid email or password.", channel: "banner" }]
  );

  // The right password signs in and lands on the page returnTo names.
  await page.getByLabel("Password", { exact: true }).fill("correct horse");
  await submit.click();
  await page.waitForURL((url) => url.pathname === "/console");
  assert.deepEqual(bodiesOf(api, "POST /api/login"), [
    { email: "ada@example.com", password: "wrong password" },
    { email: "ada@example.com", password: "correct horse" }
  ]);
  assert.deepEqual(api.requests.filter((request) => request.key === "POST /api/login").map((request) => request.csrf), ["fixture-csrf", "fixture-csrf"]);

  // A route that asks for a fresh code opens the app's own prompt; a wrong code is refused beside its field, the right
  // one runs the request again.
  await page.getByRole("button", { name: "Refund" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  assert.deepEqual(await vuetifyElements(page), []);
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("That code is not right. Enter the code your authenticator app shows now.")).toBeVisible();
  await dialog.getByLabel("6-digit code").fill("123456");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("console-outcome")).toHaveText("Refunded");
  await expect(dialog).toBeHidden();
  assert.equal(bodiesOf(api, "POST /api/console/refund").length, 2);
  assert.deepEqual(bodiesOf(api, "POST /api/second-factor/verify"), [{ code: "000000" }, { code: "123456" }]);

  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
});
