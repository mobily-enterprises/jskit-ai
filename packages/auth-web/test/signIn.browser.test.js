import assert from "node:assert/strict";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const CAPABILITIES = {
  provider: { id: "local", label: "Local" },
  features: {
    password: { login: true, register: true },
    passwordRecovery: { request: true, complete: true },
    otp: { login: true },
    oauthLogin: { enabled: true, defaultProvider: "google", providers: [{ id: "google", label: "Google" }] },
    emailConfirmation: true
  }
};
const SIGNED_OUT = { authenticated: false, csrfToken: "fixture-csrf", authCapabilities: CAPABILITIES };
const SIGNED_IN = {
  ...SIGNED_OUT,
  authenticated: true,
  username: "Ada Lovelace",
  email: "ada@example.com",
  permissions: ["read"]
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

function deny(status, message) {
  return { status, json: { error: message } };
}

/**
 * One page with the auth API behind it. `routes` answers "METHOD /path" with a fulfil value or a function of the
 * request's body; anything else under /api is a test failure.
 */
async function openApp({ session = SIGNED_OUT, routes = {}, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ baseURL: runtime.baseURL, viewport });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const api = { session, routes, requests: [], unexpected: [], errors: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: api.session });
      return;
    }
    api.requests.push({ key, search, body: request.postDataJSON(), csrf: request.headers()["csrf-token"] });
    const answerFor = api.routes[key];
    if (!answerFor) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    const answer = typeof answerFor === "function" ? answerFor(request.postDataJSON()) : answerFor;
    await route.fulfill(answer);
  });
  return api;
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

function reports(page) {
  return page.evaluate(() => window.authFixture.reports);
}

// The page itself, not a sign-in page whose returnTo=/home also ends the address.
function waitForHome(page) {
  return page.waitForURL((url) => url.pathname === "/home");
}

async function signIn(page, email, password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByTestId("auth-submit").click();
}

test("password sign-in opens the requested page, remembers the account, and sign-out brings it back", options, async () => {
  const api = await openApp({
    routes: {
      "POST /api/login": () => {
        api.session = SIGNED_IN;
        return { json: { ok: true, username: "Ada Lovelace" } };
      },
      "POST /api/logout": () => {
        api.session = SIGNED_OUT;
        return { json: { ok: true } };
      }
    }
  });
  const { page } = api;
  await page.goto("/auth/login?returnTo=/home");
  await expect(page.getByTestId("auth-mode-register")).toBeVisible();
  await expect(page.locator(".login-screen--mobile")).toHaveCount(0);

  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Email").blur();
  await expect(page.locator(".v-messages__message").first()).toBeVisible();
  await expect(page.getByTestId("auth-submit")).toBeDisabled();

  await signIn(page, "Ada@Example.com", "correct horse");
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");
  assert.equal(new URL(page.url()).pathname, "/home");
  const login = api.requests.find((request) => request.key === "POST /api/login");
  assert.deepEqual(login.body, { email: "ada@example.com", password: "correct horse" });
  assert.equal(login.csrf, "fixture-csrf");
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem("auth.rememberedAccount"))),
    {
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      maskedEmail: "a***@example.com",
      lastUsedAt: await page.evaluate(() => JSON.parse(localStorage.getItem("auth.rememberedAccount")).lastUsedAt)
    }
  );
  await expect(page.getByRole("button", { name: /Ada Lovelace/u })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.authFixture.context.auth.permissions), ["read"]);

  await page.goto("/auth/signout?returnTo=/home");
  await expect(page.getByText("Welcome back, Ada Lovelace")).toBeVisible();
  assert.equal(new URL(page.url()).search, "?returnTo=%2Fhome");
  assert.equal(api.requests.filter((request) => request.key === "POST /api/logout").length, 1);
  await expect(page.getByText("a***@example.com")).toBeVisible();
  await expect(page.getByTestId("auth-mode-register")).toHaveCount(0);

  await page.getByRole("button", { name: "Use another account" }).click();
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByTestId("auth-mode-register")).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth.rememberedAccount")), null);
  await finish(api);
});

test("a refused sign-in reports the server's error and leaves the form usable", options, async () => {
  const api = await openApp({ routes: { "POST /api/login": deny(401, "Invalid email or password.") } });
  const { page } = api;
  await page.goto("/auth/login");
  await signIn(page, "ada@example.com", "wrong password");
  await expect.poll(async () => (await reports(page)).length).toBe(1);
  const [report] = await reports(page);
  assert.deepEqual(
    { source: report.source, message: report.message, severity: report.severity, channel: report.channel },
    { source: "auth-web.default-login-view", message: "Invalid email or password.", severity: "error", channel: "banner" }
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("wrong password");
  await expect(page.getByTestId("auth-submit")).toBeEnabled();
  assert.equal(new URL(page.url()).pathname, "/auth/login");
  await finish(api);
});

test("a signed-in visitor leaves the sign-in page, on opening it and when a session starts elsewhere", options, async () => {
  const signedIn = await openApp({ session: SIGNED_IN });
  await signedIn.page.goto("/auth/login?returnTo=/home");
  await expect(signedIn.page.getByTestId("home")).toHaveText("Signed in: true");
  await finish(signedIn);

  const api = await openApp();
  const { page } = api;
  await page.goto("/auth/login?returnTo=/home");
  await expect(page.getByTestId("auth-submit")).toBeVisible();
  api.session = SIGNED_IN;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitForHome(page);
  await finish(api);
});

test("the shell guard sends a signed-out visitor to sign-in, and follows the session", options, async () => {
  const api = await openApp();
  const { page } = api;
  await page.goto("/home");
  await expect(page.getByTestId("home")).toHaveText("Signed in: false");
  const evaluate = () => page.evaluate((key) => window[key]({
    guard: { policy: "authenticated" },
    context: { location: { pathname: "/home", search: "?tab=2" } }
  }), GUARD_EVALUATOR_KEY);
  assert.deepEqual(await evaluate(), {
    allow: false,
    redirectTo: "/auth/login?returnTo=%2Fhome%3Ftab%3D2",
    reason: "auth-required"
  });
  assert.deepEqual(
    await page.evaluate((key) => window[key]({ guard: { policy: "public" }, context: {} }), GUARD_EVALUATOR_KEY),
    { allow: true, redirectTo: "", reason: "" }
  );
  await finish(api);

  const signedIn = await openApp({ session: SIGNED_IN });
  await signedIn.page.goto("/home");
  await expect(signedIn.page.getByTestId("home")).toHaveText("Signed in: true");
  assert.deepEqual(
    await signedIn.page.evaluate((key) => window[key]({ guard: { policy: "authenticated" }, context: {} }), GUARD_EVALUATOR_KEY),
    { allow: true, redirectTo: "", reason: "" }
  );
  await finish(signedIn);
});

test("register waits for email confirmation, and the other modes reach their requests", options, async () => {
  const api = await openApp({
    routes: {
      "POST /api/register": { json: { requiresEmailConfirmation: true, username: "Ada" } },
      "POST /api/register/confirmation/resend": { json: { ok: true } },
      "POST /api/password/forgot": { json: { ok: true } },
      "POST /api/login/otp/request": { json: { ok: true } },
      "POST /api/login/otp/verify": () => {
        api.session = SIGNED_IN;
        return { json: { ok: true, username: "Ada" } };
      }
    }
  });
  const { page } = api;
  await page.goto("/auth/login?returnTo=/home&mode=register&invitationToken=invite-1");
  await expect(page.getByText("Create your account")).toBeVisible();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Correct-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).fill("Different-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).blur();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByTestId("auth-submit")).toBeDisabled();
  await page.getByLabel("Confirm password", { exact: true }).fill("Correct-horse-1");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByText("Confirm your email")).toBeVisible();
  await expect(page.getByText("a***@example.com")).toBeVisible();
  assert.deepEqual(api.requests.at(-1).body, {
    email: "ada@example.com",
    password: "Correct-horse-1",
    invitation: { token: "invite-1", source: "workspace-invite" }
  });
  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  await expect.poll(() => api.requests.at(-1).key).toBe("POST /api/register/confirmation/resend");
  assert.deepEqual(api.requests.at(-1).body, { email: "ada@example.com" });

  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("Reset your password")).toBeVisible();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByTestId("auth-submit").click();
  await expect.poll(async () => (await reports(page)).at(-1)?.message).toBe("Password reset instructions sent.");

  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Use one-time code" }).click();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send one-time code" }).click();
  await expect.poll(() => api.requests.at(-1).key).toBe("POST /api/login/otp/request");
  assert.deepEqual(api.requests.at(-1).body, { email: "ada@example.com", returnTo: "/home" });
  await page.getByLabel("One-time code").fill("123456");
  await page.getByTestId("auth-submit").click();
  await waitForHome(page);
  await finish(api);
});

test("email confirmation takes the registration's password: the development link, a pasted link after an unconfirmed sign-in, and the emailed link", options, async () => {
  const session = {
    ...SIGNED_OUT,
    authCapabilities: { ...CAPABILITIES, features: { ...CAPABILITIES.features, emailConfirmationCode: true } }
  };
  const confirmations = [];
  async function openConfirmingApp() {
    const api = await openApp({ session });
    Object.assign(api.routes, {
      "POST /api/register": {
        status: 201,
        json: {
          ok: true,
          requiresEmailConfirmation: true,
          message: "Check your email to confirm the account before logging in.",
          messageCode: "auth.register.confirmEmail",
          messageParams: {},
          confirmationUrl: "http://localhost:5173/auth/login?confirmation_token=dev-token-1"
        }
      },
      "POST /api/register/confirm": (body) => {
        confirmations.push(body.token);
        if (body.password !== "Correct-horse-1") {
          return {
            status: 400,
            json: {
              error: "That is not the password this registration was made with. Enter the password you registered with, or register again.",
              code: "auth.local.register.confirmationPasswordInvalid"
            }
          };
        }
        if (body.token === "expired-token") {
          return {
            status: 400,
            json: {
              error: "This confirmation link is invalid or has expired. Register again to get a new one.",
              code: "auth.local.register.confirmationInvalid"
            }
          };
        }
        api.session = SIGNED_IN;
        return { json: { ok: true, email: "ada@example.com", username: "Ada", message: "Your email is confirmed." } };
      },
      "POST /api/login": {
        status: 403,
        json: {
          error: "Confirm your email address before signing in: open the link we emailed you, or ask for a new one.",
          code: "auth.login.emailUnconfirmed"
        }
      }
    });
    return api;
  }

  // Registering in development shows the link, and its button confirms with the password just typed and signs in.
  const registering = await openConfirmingApp();
  await registering.page.goto("/auth/login?mode=register&returnTo=/home");
  await registering.page.getByLabel("Email").fill("ada@example.com");
  await registering.page.getByLabel("Password", { exact: true }).fill("Correct-horse-1");
  await registering.page.getByLabel("Confirm password", { exact: true }).fill("Correct-horse-1");
  await registering.page.getByTestId("auth-submit").click();
  await expect(registering.page.getByTestId("auth-confirmation-dev-link")).toContainText("confirmation_token=dev-token-1");
  await registering.page.getByTestId("auth-confirmation-dev-confirm").click();
  await waitForHome(registering.page);
  assert.deepEqual(confirmations, ["dev-token-1"]);
  await finish(registering);

  // Signing in before confirming opens "Confirm your email", where a pasted link confirms with the password typed.
  const signingIn = await openConfirmingApp();
  await signingIn.page.goto("/auth/login?returnTo=/home");
  await signIn(signingIn.page, "ada@example.com", "Correct-horse-1");
  await expect(signingIn.page.getByText("Confirm your email", { exact: true })).toBeVisible();
  await expect(signingIn.page.getByText("Confirm your email address before signing in")).toBeVisible();
  await signingIn.page.getByLabel("Confirmation link or code").fill(
    "http://localhost:5173/auth/login?confirmation_token=pasted-token-2"
  );
  await signingIn.page.getByLabel("Confirmation link or code").press("Enter");
  await waitForHome(signingIn.page);
  assert.deepEqual(confirmations.at(-1), "pasted-token-2");
  await finish(signingIn);

  // An emailed link asks for the registration's password, and its code leaves the address. A wrong password, or a link
  // that expired, says so; the right password confirms and signs in.
  const expired = await openConfirmingApp();
  await expired.page.goto("/auth/login?confirmation_token=expired-token&returnTo=/home");
  await expect(expired.page.getByText("Enter your password to finish confirming your email.")).toBeVisible();
  assert.equal(new URL(expired.page.url()).search, "?returnTo=%2Fhome");
  await expect(expired.page.getByTestId("auth-confirmation-link-submit")).toBeDisabled();
  await expired.page.getByLabel("Password you registered with", { exact: true }).fill("Correct-horse-1");
  await expired.page.getByTestId("auth-confirmation-link-submit").click();
  await expect.poll(async () => (await reports(expired.page)).at(-1)?.message)
    .toBe("This confirmation link is invalid or has expired. Register again to get a new one.");
  await finish(expired);
  const emailed = await openConfirmingApp();
  await emailed.page.goto("/auth/login?confirmation_token=emailed-token-3&returnTo=/home");
  await emailed.page.getByLabel("Password you registered with", { exact: true }).fill("a wrong password");
  await emailed.page.getByTestId("auth-confirmation-link-submit").click();
  await expect.poll(async () => (await reports(emailed.page)).at(-1)?.message).toBe(
    "That is not the password this registration was made with. Enter the password you registered with, or register again."
  );
  await emailed.page.getByLabel("Password you registered with", { exact: true }).fill("Correct-horse-1");
  await emailed.page.getByLabel("Password you registered with", { exact: true }).press("Enter");
  await waitForHome(emailed.page);
  assert.deepEqual(confirmations.slice(-3), ["expired-token", "emailed-token-3", "emailed-token-3"]);
  await finish(emailed);
});

test("while the app has no account, registering asks for the setup code and sends it", options, async () => {
  const api = await openApp({
    session: {
      ...SIGNED_OUT,
      authCapabilities: { ...CAPABILITIES, features: { ...CAPABILITIES.features, firstAccountSetupCode: true } }
    },
    routes: {
      "POST /api/register": () => {
        api.session = SIGNED_IN;
        return { status: 201, json: { ok: true, requiresEmailConfirmation: false, username: "Ada" } };
      }
    }
  });
  const { page } = api;
  await page.goto("/auth/login?mode=register&returnTo=/home");
  await expect(page.getByTestId("auth-first-account-setup")).toContainText("This app has no account yet.");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Correct-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).fill("Correct-horse-1");
  await expect(page.getByTestId("auth-submit")).toBeDisabled();
  await page.getByLabel("Setup code").fill("ABCDE-FGHJK-MNPQR-STVWX");
  await page.getByTestId("auth-submit").click();
  await waitForHome(page);
  assert.deepEqual(api.requests.at(-1).body, {
    email: "ada@example.com",
    password: "Correct-horse-1",
    setupCode: "ABCDE-FGHJK-MNPQR-STVWX"
  });
  await finish(api);
});

test("OAuth starts at the provider and a callback finishes on the requested page or reports why it failed", options, async () => {
  const start = await openApp({
    routes: { "GET /api/oauth/google/start": { contentType: "text/html", body: "<p>Provider</p>" } }
  });
  await start.page.goto("/auth/login?returnTo=/home");
  await start.page.getByRole("button", { name: "Continue with Google" }).click();
  await start.page.getByText("Provider").waitFor();
  assert.equal(start.requests.at(-1).search, "?returnTo=%2Fhome");
  await finish(start);

  const api = await openApp({
    routes: {
      "POST /api/oauth/complete": (body) => {
        api.session = SIGNED_IN;
        return { json: { ok: true, email: "ada@example.com", username: "Ada" } };
      }
    }
  });
  await api.page.goto("/auth/login?code=code-1&state=state-1&oauthProvider=google&oauthReturnTo=/home");
  await expect(api.page.getByTestId("home")).toHaveText("Signed in: true");
  assert.deepEqual(api.requests.at(-1).body, { provider: "google", code: "code-1", state: "state-1" });
  await finish(api);

  const landed = await openApp({
    routes: {
      "POST /api/oauth/complete": () => {
        landed.session = SIGNED_IN;
        return { json: { ok: true, email: "ada@example.com" } };
      }
    }
  });
  await landed.page.goto("/home?code=code-2&oauthProvider=google");
  await expect(landed.page.getByTestId("home")).toHaveText("Signed in: true");
  assert.equal(new URL(landed.page.url()).searchParams.has("code"), false);
  await finish(landed);

  const failed = await openApp();
  await failed.page.goto("/auth/login?error=access_denied&error_description=Denied%20by%20user&oauthProvider=google");
  await expect.poll(async () => (await reports(failed.page)).at(-1)?.message).toBe("Denied by user");
  assert.equal(new URL(failed.page.url()).search, "");
  await expect(failed.page.getByTestId("auth-submit")).toBeVisible();
  await finish(failed);
});

test("password recovery exchanges the link, clears it from the address, and updates the password", options, async () => {
  const api = await openApp({
    routes: {
      "POST /api/password/recovery": { json: { ok: true } },
      "POST /api/password/reset": { json: { ok: true } }
    }
  });
  const { page } = api;
  await page.goto("/auth/reset-password#access_token=token-a&refresh_token=token-r&type=recovery");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).hash, "");
  assert.deepEqual(api.requests[0].body, { accessToken: "token-a", refreshToken: "token-r", type: "recovery" });

  await page.getByLabel("New password", { exact: true }).fill("Correct-horse-1");
  await page.getByLabel("Confirm password", { exact: true }).fill("Different-horse-1");
  await expect(page.getByText("Passwords must match.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update password" })).toBeDisabled();
  await page.getByLabel("Confirm password", { exact: true }).fill("Correct-horse-1");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
  assert.deepEqual(api.requests.at(-1).body, { password: "Correct-horse-1" });
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/login");
  await finish(api);

  const invalid = await openApp({ routes: { "POST /api/password/recovery": deny(400, "Recovery link expired.") } });
  await invalid.page.goto("/auth/reset-password?token=stale");
  await expect(invalid.page.getByText("Recovery link expired.")).toBeVisible();
  await expect(invalid.page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(invalid.page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  await finish(invalid);
});

test("a failed sign-out shows the error and retries, on a phone-sized screen", options, async () => {
  let failures = 1;
  const api = await openApp({
    session: SIGNED_IN,
    viewport: { width: 390, height: 844 },
    routes: {
      "POST /api/logout": () => {
        if (failures > 0) {
          failures -= 1;
          return deny(503, "Sign-out service down.");
        }
        api.session = SIGNED_OUT;
        return { json: { ok: true } };
      }
    }
  });
  const { page } = api;
  await page.goto("/auth/signout?returnTo=/home");
  await expect(page.getByText("Sign-out service down.")).toBeVisible();
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await page.waitForURL("**/auth/login?returnTo=%2Fhome");
  await expect(page.locator(".login-screen--mobile")).toHaveCount(1);
  await finish(api);
});

// The app bar's account control leaves the bar's title and actions their room: an icon button around the avatar on
// compact and medium windows, and on expanded ones the name beside it, ending in an ellipsis past 12rem.
test("the account control is the avatar alone up to medium width and truncates a long name beside it on wider windows", options, async () => {
  const name = "Augusta Ada King, Countess of Lovelace and First Programmer";
  const api = await openApp({ session: { ...SIGNED_IN, username: name }, viewport: { width: 768, height: 1024 } });
  const { page } = api;
  await page.goto("/home");
  const control = page.getByRole("button", { name });
  await expect(control).toBeVisible();
  assert.equal(await control.evaluate((element) => element.classList.contains("v-btn--icon")), true, "an icon button at 768");
  await expect(page.locator(".auth-profile-widget__name")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  const label = page.locator(".auth-profile-widget__name");
  await expect(label).toHaveText(name);
  const shown = await label.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    truncated: element.scrollWidth > element.clientWidth,
    rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  }));
  assert.ok(shown.width <= 12 * shown.rem + 1, `the name takes at most 12rem: ${shown.width}px`);
  assert.equal(shown.truncated, true, "a long name ends in an ellipsis");
  await finish(api);
});

// Material 3's segmented button: one outline, equal segments, the selected one on secondary-container with a check.
// Register has no "Back to sign in": the Sign in segment is the way back.
test("Sign in and Register are a segmented button, and Register has no way back but its segment", options, async () => {
  const api = await openApp();
  const { page } = api;
  await page.goto("/auth/login");
  const group = page.getByRole("radiogroup", { name: "Sign in or register" });
  await expect(group).toBeVisible();
  const read = () => group.evaluate((element) => {
    const role = (name) => {
      const probe = document.body.appendChild(document.createElement("span"));
      probe.style.color = `rgb(var(--v-theme-${name}))`;
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(element);
    return {
      outline: [style.borderTopWidth, style.borderTopColor === role("outline"), style.borderTopLeftRadius],
      height: element.getBoundingClientRect().height,
      segments: [...element.querySelectorAll("[role=radio]")].map((segment) => {
        const segmentStyle = getComputedStyle(segment);
        return {
          name: segment.textContent.trim(),
          checked: segment.getAttribute("aria-checked"),
          width: Math.round(segment.getBoundingClientRect().width),
          check: segment.querySelectorAll(".v-btn__prepend .v-icon").length,
          filled: segmentStyle.backgroundColor === role("secondary-container"),
          type: [segmentStyle.fontSize, segmentStyle.fontWeight]
        };
      })
    };
  });
  const expected = (selected) => {
    const segments = ["Sign in", "Register"].map((name) => ({
      name,
      checked: String(name === selected),
      check: name === selected ? 1 : 0,
      filled: name === selected,
      type: ["14px", "500"]
    }));
    return { outline: ["1px", true, "9999px"], height: 40, segments };
  };
  const withoutWidths = ({ segments, ...rest }) => ({ ...rest, segments: segments.map(({ width, ...segment }) => segment) });

  const layout = await read();
  assert.deepEqual(withoutWidths(layout), expected("Sign in"));
  assert.equal(layout.segments[0].width, layout.segments[1].width, "the segments are equal");

  await page.getByRole("radio", { name: "Register" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  // The segments' fill changes through Vuetify's background transition.
  await expect.poll(async () => withoutWidths(await read())).toEqual(expected("Register"));
  await expect(page.getByRole("button", { name: "Back to sign in" })).toHaveCount(0);
  await expect(page.getByText("Already have an account?")).toHaveCount(0);

  await page.getByRole("radio", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await finish(api);
});

test("every auth screen has its one h1, sign-in's included", options, async () => {
  const api = await openApp({
    routes: {
      "POST /api/password/recovery": deny(400, "Recovery link expired."),
      "POST /api/logout": deny(503, "Sign-out service down.")
    }
  });
  const { page } = api;
  const heading = async (name) => {
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    assert.equal(await page.locator("h1").count(), 1, `one h1 for ${name}`);
  };
  await page.goto("/auth/login");
  await heading("Sign in");
  await page.getByTestId("auth-mode-register").click();
  await heading("Create your account");
  await page.getByTestId("auth-mode-sign-in").click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await heading("Reset your password");
  await page.goto("/auth/reset-password?token=stale");
  await heading("Reset password");
  await page.goto("/auth/signout");
  await heading("Signing you out");
  await finish(api);
});

test("an app's brand shows in a pane beside the card on wide windows and in a row above it on phones", options, async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const at = `${viewport.width}px`;
    const api = await openApp({
      viewport,
      routes: {
        "POST /api/password/recovery": deny(400, "Recovery link expired."),
        "POST /api/logout": deny(503, "Sign-out service down.")
      }
    });
    const { page } = api;
    for (const [path, title] of [["/auth/branded/login", "Sign in"], ["/auth/branded/reset-password?token=stale", "Reset password"], ["/auth/branded/signout", "Signing you out"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title }), `${at} ${path}`).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
        const screen = document.querySelector("[data-testid='auth-screen']");
        return {
          pane: box("[data-testid='auth-brand-pane']"),
          row: box("[data-testid='auth-brand-row']"),
          card: box("[data-testid='auth-screen'] .v-card"),
          treatment: (() => {
            const style = window.getComputedStyle(document.querySelector("[data-testid='auth-screen'] .v-card"));
            return { shadow: style.boxShadow, border: style.borderTopWidth, background: style.backgroundColor };
          })(),
          screenBackground: window.getComputedStyle(screen).backgroundColor,
          h1s: document.querySelectorAll("h1").length,
          overflow: screen.scrollWidth - screen.clientWidth
        };
      });
      assert.equal(layout.h1s, 1, `${at} ${path}: the brand adds no heading`);
      // Vuetify's flat variant computes as zero-size shadow layers: every offset, blur and spread is 0.
      const shadowSizes = layout.treatment.shadow === "none" ? [] : layout.treatment.shadow.replace(/rgba?\([^)]*\)/gu, "").match(/-?[\d.]+px/gu) || [];
      assert.deepEqual(shadowSizes.filter((size) => Number.parseFloat(size) !== 0), [], `${at} ${path}: the card has no shadow (${layout.treatment.shadow})`);
      assert.equal(layout.treatment.border, "0px", `${at} ${path}: the card has no outline`);
      assert.ok(layout.overflow <= 0, `${at} ${path}: no sideways scroll`);
      if (viewport.width >= 960) {
        assert.equal(layout.row, null, `${at} ${path}: no compact row`);
        await expect(page.getByTestId("fixture-brand-pane")).toBeVisible();
        assert.equal(Math.round(layout.pane.left), 0, `${at} ${path}: the pane starts at the window's edge`);
        assert.equal(Math.round(layout.pane.height), viewport.height, `${at} ${path}: the pane fills the height`);
        assert.ok(layout.card.left >= layout.pane.right, `${at} ${path}: the card is beside the pane`);
        assert.notEqual(layout.treatment.background, layout.screenBackground, `${at} ${path}: the card's tone sets it off the screen`);
      } else {
        assert.equal(layout.pane, null, `${at} ${path}: no pane`);
        await expect(page.getByTestId("fixture-brand-row")).toBeVisible();
        assert.ok(layout.row.bottom <= layout.card.top + 1, `${at} ${path}: the row is above the card`);
        assert.equal(Math.round(layout.card.width), viewport.width, `${at} ${path}: the card is full-bleed`);
        assert.ok(Math.round(layout.card.bottom) >= viewport.height, `${at} ${path}: the card fills the rest`);
      }
    }
    // Without a brand there is neither.
    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("auth-brand-pane")).toHaveCount(0);
    await expect(page.getByTestId("auth-brand-row")).toHaveCount(0);
    await finish(api);
  }
});

// The auth-surface pattern's own pages, as an app copies them: each renders the app's view wrapper, which puts the
// app's name (AppBrand.vue, "Reading Room") in the brand slot, so every screen says which app it signs in to.
test("the auth-surface pattern's sign-in, reset and sign-out pages show the app's name", options, async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const at = `${viewport.width}px`;
    const api = await openApp({
      viewport,
      routes: {
        "POST /api/password/recovery": deny(400, "Recovery link expired."),
        "POST /api/logout": deny(503, "Sign-out service down.")
      }
    });
    const { page } = api;
    for (const [path, title] of [["/auth/pattern/login", "Sign in"], ["/auth/pattern/reset-password?token=stale", "Reset password"], ["/auth/pattern/signout", "Signing you out"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title }), `${at} ${path}`).toBeVisible();
      const holder = page.getByTestId(viewport.width >= 960 ? "auth-brand-pane" : "auth-brand-row");
      await expect(holder.getByTestId("app-brand"), `${at} ${path}`).toHaveText("Reading Room");
      await expect(page.getByTestId("app-brand"), `${at} ${path}: one brand`).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 }), `${at} ${path}: the brand adds no heading`).toHaveCount(1);
    }
    await finish(api);
  }
});

test("an app whose accounts are by invitation offers Register only to an invited person", options, async () => {
  const invitationOnly = {
    ...SIGNED_OUT,
    authCapabilities: { ...CAPABILITIES, features: { ...CAPABILITIES.features, password: { login: true, register: true, selfRegister: false } } }
  };
  const api = await openApp({ session: invitationOnly });
  const { page } = api;
  await page.goto("/auth/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  // Sign in alone is no choice: no segmented button.
  await expect(page.getByTestId("auth-mode-switch")).toHaveCount(0);
  await page.goto("/auth/login?invitationToken=invite-for-bea");
  await expect(page.getByTestId("auth-mode-sign-in")).toBeVisible();
  await expect(page.getByTestId("auth-mode-register")).toBeVisible();
  await finish(api);
});
