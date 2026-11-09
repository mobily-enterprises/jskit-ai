import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { en as vuetifyEnglish } from "vuetify/locale";
import { flattenCatalog, formatMessage } from "@jskit-ai/kernel/shared/i18n";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

// The translation acceptance test: an app exports a pseudo-locale with
// `jskit i18n export`, translates every message, switches to it, and no JSKIT
// screen it opens shows English.
const RUN = process.env.JSKIT_USERS_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const LOCALE = "en-XA";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const JSKIT_CLI = path.join(REPOSITORY_ROOT, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/translated-app/", import.meta.url));
const APP_MESSAGES = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "appMessages.json"), "utf8"));

// Every ASCII letter becomes an accented one, so any ASCII word left on a page
// is text that did not come through the translation.
const ASCII_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PSEUDO_LETTERS = [..."áƀçđéƒĝĥíĵķĺɱñóþʠŕšţúṽŵẋýžÁƁÇĐÉƑĜĤÍĴĶĹṀÑÓÞǪŔŠŢÚṼŴẊÝŽ"];
const PSEUDO = new Map([...ASCII_LETTERS].map((letter, index) => [letter, PSEUDO_LETTERS[index]]));
// Words that are the fixture's data (names, email, providers), not interface text.
const DATA_WORDS = new Set(["Ada", "AD", "AL", "Lovelace", "ada", "example", "com", "Google", "GitHub", "Local"]);
// Vuetify's own labels ("{0} appended action") are translated through Vuetify's
// locale, not JSKIT's.
const VUETIFY_TEXTS = Object.values(flattenCatalog(vuetifyEnglish))
  .map(String)
  .filter((message) => /[A-Za-z]{2,}/u.test(message.replace(/\{\d+\}/gu, "")))
  .map((message) => new RegExp(
    `^${message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\\\{\d+\\\}/gu, ".*")}$`,
    "u"
  ));

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
const SIGNED_IN = { ...SIGNED_OUT, authenticated: true, username: "Ada Lovelace", email: "ada@example.com" };

let projectRoot = "";
let english = {};
let messages = {};
let pseudo = {};
let runtime = null;
let browser = null;

// Accents the letters outside {placeholders}; placeholders, quoted literals and
// the | between plural choices stay as written.
function pseudoMessage(message) {
  let result = "";
  for (let index = 0; index < message.length; index += 1) {
    if (message[index] !== "{") {
      result += PSEUDO.get(message[index]) ?? message[index];
      continue;
    }
    let end = index + 1;
    let quoted = false;
    while (end < message.length && (message[end] !== "}" || quoted)) {
      if (message[end] === "'") quoted = !quoted;
      end += 1;
    }
    result += message.slice(index, end + 1);
    index = end;
  }
  return result;
}

function pseudoCatalog(catalog) {
  return Object.fromEntries(Object.entries(catalog).map(([name, value]) => [
    name,
    typeof value === "string" ? pseudoMessage(value) : pseudoCatalog(value)
  ]));
}

function jskit(...args) {
  return execFileSync(process.execPath, [JSKIT_CLI, "i18n", ...args, "--root", projectRoot], { encoding: "utf8" });
}

/** The English of a JSKIT key, as a server sends it. */
function englishOf(key, params = {}) {
  assert.ok(Object.hasOwn(english, key), `${key} is not in the exported English`);
  return formatMessage(english[key], params);
}

/** The pseudo-locale text of a JSKIT or app key, as the page shows it. */
function shown(key, params = {}) {
  const message = pseudo[key];
  assert.ok(message !== undefined, `${key} is not translated`);
  return formatMessage(message, params);
}

before(async () => {
  if (!RUN) return;
  // A throwaway app that installs users-web, with the repository's packages as its node_modules.
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jskit-translated-app-"));
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "translated-app",
    private: true,
    type: "module",
    dependencies: { "@jskit-ai/users-web": "*" }
  }));
  fs.symlinkSync(path.join(REPOSITORY_ROOT, "node_modules"), path.join(projectRoot, "node_modules"), "dir");
  jskit("export", LOCALE);
  const file = path.join(projectRoot, "src", "locales", LOCALE, "jskit.json");
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  english = flattenCatalog(exported);
  fs.writeFileSync(file, `${JSON.stringify(pseudoCatalog(exported), null, 2)}\n`);
  jskit("check", LOCALE);
  // What the app loads for the locale: the translated JSKIT file and its own messages.
  messages = { ...JSON.parse(fs.readFileSync(file, "utf8")), ...pseudoCatalog(APP_MESSAGES) };
  pseudo = flattenCatalog(messages);

  runtime = await startViteFixture({ fixtureRoot: FIXTURE_ROOT });
  browser = await chromium.launch(createChromiumLaunchOptions());
});

after(async () => {
  await browser?.close();
  await stopProcess(runtime);
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

/** One page in the pseudo-locale with the API behind it; anything unexpected under /api is a failure. */
async function openApp({ session = SIGNED_OUT, routes = {} } = {}) {
  const page = await browser.newPage({ baseURL: runtime.baseURL, viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  await page.addInitScript((translation) => {
    window.translatedFixture = translation;
  }, { locale: LOCALE, messages });
  const api = { session, requests: [], unexpected: [], errors: [], diagnostics: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") api.diagnostics.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith("/api/")) {
      api.diagnostics.push(`${response.status()} ${response.url()}`);
    }
  });
  // Opens a page and waits for the app to mount, naming what stopped it otherwise.
  api.open = async (url) => {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 20_000 })
      .catch(() => {
        throw new Error(`the app did not mount at ${url}: ${JSON.stringify([...api.errors, ...api.diagnostics])}`);
      });
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const key = `${request.method()} ${pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: api.session });
      return;
    }
    api.requests.push(key);
    if (!routes[key]) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    const answer = typeof routes[key] === "function" ? routes[key]() : routes[key];
    await (answer === "abort" ? route.abort("internetdisconnected") : route.fulfill(answer));
  });
  return api;
}

/** Lines of visible text and visible labelling attributes that still carry an ASCII word. */
async function leftoverEnglish(page) {
  const texts = await page.evaluate(() => {
    const found = document.body.innerText.split("\n");
    for (const element of document.querySelectorAll("[placeholder], [title], [aria-label], [alt]")) {
      if (!element.checkVisibility()) continue;
      for (const name of ["placeholder", "title", "aria-label", "alt"]) {
        const value = element.getAttribute(name);
        if (value) found.push(value);
      }
    }
    return found;
  });
  return texts.filter((line) => {
    const value = line.trim();
    if (!value || VUETIFY_TEXTS.some((pattern) => pattern.test(value))) return false;
    return (value.match(/[A-Za-z]{2,}/gu) || []).some((word) => !DATA_WORDS.has(word));
  });
}

async function assertTranslated(page, screen) {
  assert.deepEqual(await leftoverEnglish(page), [], `${screen} shows English`);
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

test("the export holds every rendered package's English and the pseudo-locale passes jskit i18n check", options, () => {
  for (const namespace of ["auth", "users", "shell", "http", "kernel", "crud"]) {
    assert.ok(Object.keys(english).some((key) => key.startsWith(`jskit.${namespace}.`)), `no jskit.${namespace} keys exported`);
  }
  assert.equal(shown("jskit.auth.login.field.email"), "Éɱáíĺ");
});

test("sign-in, registration and password reset show only the pseudo-locale", options, async () => {
  const api = await openApp({
    routes: {
      "POST /api/login": {
        status: 401,
        json: { error: englishOf("jskit.auth.login.invalidCredentials"), code: "auth.login.invalidCredentials" }
      },
      "POST /api/password/forgot": { json: { ok: true } }
    }
  });
  const { page } = api;
  await api.open("/auth/login?returnTo=/home");
  await expect(page.getByTestId("auth-mode-register")).toBeVisible();
  await assertTranslated(page, "sign-in");

  await page.getByLabel(shown("jskit.auth.login.field.email")).fill("ada@example.com");
  await page.getByLabel(shown("jskit.auth.login.field.password"), { exact: true }).fill("wrong horse");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByText(shown("jskit.auth.login.invalidCredentials")).first()).toBeVisible();
  await assertTranslated(page, "a refused sign-in");

  await page.getByTestId("auth-mode-register").click();
  await expect(page.getByText(shown("jskit.auth.login.title.register"))).toBeVisible();
  await page.getByLabel(shown("jskit.auth.login.field.password"), { exact: true }).fill("Correct-horse-1");
  await page.getByLabel(shown("jskit.auth.login.field.confirmPassword"), { exact: true }).fill("Different-horse-1");
  await page.getByLabel(shown("jskit.auth.login.field.confirmPassword"), { exact: true }).blur();
  await expect(page.getByText(shown("jskit.auth.login.passwordsMismatch"))).toBeVisible();
  await assertTranslated(page, "registration");

  await page.getByTestId("auth-mode-sign-in").click();
  await page.getByRole("button", { name: shown("jskit.auth.login.forgotPassword") }).click();
  await expect(page.getByText(shown("jskit.auth.login.title.forgot"))).toBeVisible();
  await assertTranslated(page, "password reset request");
  await page.getByLabel(shown("jskit.auth.login.field.email")).fill("ada@example.com");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByText(shown("jskit.auth.login.resetSent")).first()).toBeVisible();
  await assertTranslated(page, "password reset sent");
  await finish(api);

  const reset = await openApp({
    routes: { "POST /api/password/recovery": { json: { ok: true } }, "POST /api/password/reset": { json: { ok: true } } }
  });
  await reset.open("/auth/reset-password#access_token=token-a&refresh_token=token-r&type=recovery");
  const newPassword = reset.page.getByLabel(shown("jskit.auth.resetPassword.newPassword"), { exact: true });
  await expect(newPassword).toBeVisible();
  await newPassword.fill("Correct-horse-1");
  await reset.page.getByLabel(shown("jskit.auth.resetPassword.confirmPassword"), { exact: true }).fill("Different-horse-1");
  await expect(reset.page.getByText(shown("jskit.auth.resetPassword.passwordsMustMatch"))).toBeVisible();
  await assertTranslated(reset.page, "password reset");
  await reset.page.getByLabel(shown("jskit.auth.resetPassword.confirmPassword"), { exact: true }).fill("Correct-horse-1");
  await reset.page.getByRole("button", { name: shown("jskit.auth.resetPassword.submit") }).click();
  await expect(reset.page.getByText(shown("jskit.auth.resetPassword.done"))).toBeVisible();
  await assertTranslated(reset.page, "password updated");
  await finish(reset);
});

test("the profile menu and a refused, then retried, sign-out show only the pseudo-locale", options, async () => {
  let failures = 1;
  const api = await openApp({
    session: SIGNED_IN,
    routes: {
      "POST /api/logout": () => {
        if (failures > 0) {
          failures -= 1;
          return { status: 503, json: { error: englishOf("jskit.auth.session.unavailable"), code: "auth.session.unavailable" } };
        }
        api.session = SIGNED_OUT;
        return { json: { ok: true } };
      }
    }
  });
  const { page } = api;
  await api.open("/home");
  // On a phone, where the name is hidden, the activator is a round icon button around the avatar.
  await page.setViewportSize({ width: 390, height: 844 });
  // The resize swaps the named button for the icon one on the next render; measure only once it is shown.
  const phoneActivator = page.locator(".auth-profile-widget__activator.v-btn--icon");
  await expect(phoneActivator).toBeVisible();
  const activator = await phoneActivator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, radius: Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius) };
  });
  assert.equal(Math.round(activator.width), Math.round(activator.height), "The phone activator is as wide as it is tall.");
  assert.ok(activator.radius >= activator.height / 2, `The phone activator's corner radius was ${activator.radius}px.`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".auth-profile-widget__activator").click();
  const signOut = page.getByRole("link", { name: shown("app.menu.signOut") });
  await expect(signOut).toBeVisible();
  await assertTranslated(page, "the profile menu");

  await signOut.click();
  await expect(page.getByText(shown("jskit.auth.session.unavailable")).first()).toBeVisible();
  await assertTranslated(page, "a refused sign-out");
  await page.getByRole("button", { name: shown("jskit.auth.signOut.retry") }).click();
  await page.waitForURL("**/auth/login**");
  await expect(page.getByTestId("auth-submit")).toBeVisible();
  await api.open("/home");
  await expect(page.getByText(shown("jskit.auth.profile.guest"))).toBeVisible();
  await assertTranslated(page, "the signed-out profile widget");
  await finish(api);
});

function settingsDocument(theme = "dark") {
  return {
    contentType: "application/vnd.api+json",
    json: {
      data: {
        type: "user-settings",
        id: "7",
        attributes: {
          profile: {
            displayName: "Ada",
            email: "ada@example.com",
            avatar: { uploadedUrl: "", gravatarUrl: "", effectiveUrl: "", hasUploadedAvatar: true, size: 64, version: "1" }
          },
          preferences: {
            theme,
            locale: "en-US",
            timeZone: "UTC",
            dateFormat: "system",
            numberFormat: "system",
            currencyCode: "USD",
            avatarSize: 64
          },
          notifications: { productUpdates: true, accountActivity: false, securityAlerts: true },
          security: { authMethods: [{ kind: "password", provider: "local", configured: true }] }
        }
      }
    }
  };
}

test("account settings, their feedback and a refused field show only the pseudo-locale", options, async () => {
  let saves = 0;
  const limit = { limit: 32 };
  const api = await openApp({
    session: SIGNED_IN,
    routes: {
      "GET /api/settings": settingsDocument(),
      "PATCH /api/settings/preferences": () => {
        saves += 1;
        return saves === 1
          ? {
              status: 422,
              json: {
                error: englishOf("jskit.errors.validation_failed"),
                code: "validation_failed",
                details: {
                  fieldErrors: { theme: englishOf("jskit.kernel.validation.maxLength", limit) },
                  fieldErrorCodes: { theme: { code: "kernel.validation.maxLength", params: limit } }
                }
              }
            }
          : settingsDocument("light");
      }
    }
  });
  const { page } = api;
  await api.open("/account?returnTo=/home");
  await expect(page.getByText(shown("jskit.users.accountSettings.profile.save"))).toBeVisible();
  await assertTranslated(page, "account settings");
  // The selected section carries Material 3's pill indicator in secondary-container, not a grey rectangle.
  const selected = await page.locator(".settings-section-list .v-list-item--active").evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.background = "rgb(var(--v-theme-secondary-container))";
    document.body.append(probe);
    const indicator = window.getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, indicator, radius: Number.parseFloat(style.borderTopLeftRadius), height: element.getBoundingClientRect().height };
  });
  assert.equal(selected.background, selected.indicator);
  assert.ok(selected.radius >= selected.height / 2, `The selected section's corner radius was ${selected.radius}px.`);
  // Save keeps 16dp from the last field above it.
  const saveGap = await page.getByTestId("profile-submit-button").evaluate((button) => {
    const row = button.previousElementSibling;
    const fields = [...row.querySelectorAll(".v-input")].map((field) => field.getBoundingClientRect().bottom);
    return button.getBoundingClientRect().top - Math.max(...fields);
  });
  assert.ok(saveGap >= 15.5, `Save sat ${saveGap}px below the last field.`);

  await page.getByRole("link", { name: shown("app.settings.preferences") }).click();
  await page.waitForURL((url) => url.pathname === "/account/preferences");
  await page.getByTestId("theme-select").click();
  await expect(page.getByRole("option", { name: shown("jskit.users.accountSettings.preferences.theme.light") })).toBeVisible();
  await assertTranslated(page, "the theme choices");
  await page.keyboard.press("Escape");

  await page.getByTestId("preferences-save").click();
  await expect(page.getByText(shown("jskit.kernel.validation.maxLength", limit))).toBeVisible();
  await assertTranslated(page, "a refused preference");
  await page.getByTestId("preferences-save").click();
  await expect(page.getByText(shown("jskit.users.accountSettings.preferences.saved"))).toBeVisible();
  await assertTranslated(page, "saved preferences");
  await finish(api);
});

test("shell request recovery and http errors show only the pseudo-locale", options, async () => {
  const api = await openApp({
    session: SIGNED_IN,
    routes: {
      "GET /api/offline": "abort",
      "GET /api/broken": { status: 500, body: "" }
    }
  });
  const { page } = api;
  await api.open("/errors");
  await expect(page.getByText(shown("jskit.http.request.failedWithStatus", { status: 500 }))).toBeVisible();
  await expect(page.getByText(shown("jskit.shell.recovery.appUnreachable"))).toBeVisible();
  await assertTranslated(page, "request errors");
  await finish(api);
});
