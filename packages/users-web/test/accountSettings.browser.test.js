import assert from "node:assert/strict";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const RUN = process.env.JSKIT_USERS_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };

let runtime = null;
let browser = null;

before(async () => {
  if (!RUN) return;
  runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/account-settings/", import.meta.url)) });
  browser = await chromium.launch(createChromiumLaunchOptions());
});

after(async () => {
  await browser?.close();
  await stopProcess(runtime);
});

function settings(overrides = {}) {
  return {
    profile: {
      displayName: "Ada",
      email: "ada@example.com",
      avatar: { uploadedUrl: "/a.png", gravatarUrl: "", effectiveUrl: "", hasUploadedAvatar: true, size: 64, version: "1" }
    },
    preferences: {
      theme: "dark",
      locale: "it-IT",
      timeZone: "UTC",
      dateFormat: "system",
      numberFormat: "system",
      currencyCode: "USD",
      avatarSize: 64
    },
    notifications: { productUpdates: true, accountActivity: false, securityAlerts: true },
    security: {
      authMethods: [
        { kind: "password", provider: "local", configured: true },
        { kind: "oauth", provider: "google", label: "Google", configured: true, canDisable: true },
        { kind: "oauth", provider: "github", label: "GitHub", configured: false, canEnable: true }
      ]
    },
    ...overrides
  };
}

function document(attributes, type = "user-settings") {
  return { contentType: "application/vnd.api+json", json: { data: { type, id: "7", attributes } } };
}

/** One page with the settings API behind it; `routes` answers "METHOD /path", anything else is a test failure. */
async function openApp({ routes = {} } = {}) {
  const page = await browser.newPage({ baseURL: runtime.baseURL, viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const api = { requests: [], unexpected: [], errors: [], page };
  page.on("pageerror", (error) => api.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const key = `${request.method()} ${pathname}`;
    if (key === "GET /api/session") {
      await route.fulfill({ json: { authenticated: true, csrfToken: "fixture-csrf" } });
      return;
    }
    api.requests.push({ key, search, body: request.postDataJSON() });
    const answer = routes[key] || (key === "GET /api/settings" ? document(settings()) : null);
    if (!answer) {
      api.unexpected.push(key);
      await route.fulfill({ status: 500, json: { error: `unexpected ${key}` } });
      return;
    }
    await route.fulfill(typeof answer === "function" ? await answer(request.postDataJSON()) : answer);
  });
  return api;
}

async function finish(api) {
  assert.deepEqual(api.unexpected, []);
  assert.deepEqual(api.errors, []);
  await api.page.close();
}

/** Seconds the page's main thread works during one idle second: an update loop keeps it near 1. */
async function busySeconds(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  async function taskSeconds() {
    const { metrics } = await session.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "TaskDuration").value;
  }
  const before = await taskSeconds();
  await page.waitForTimeout(1000);
  return (await taskSeconds()) - before;
}

function lastReport(page) {
  return page.evaluate(() => window.accountFixture.reports.at(-1)?.message);
}

test("the profile section loads, saves, shows a refused field and removes the avatar", options, async () => {
  let saves = 0;
  const api = await openApp({
    routes: {
      "PATCH /api/settings/profile": () => {
        saves += 1;
        return saves === 1
          ? document(settings({ profile: { ...settings().profile, displayName: "Ada Lovelace" } }))
          : {
              status: 422,
              json: { error: "Validation failed.", details: { fieldErrors: { displayName: "Name is taken." } } }
            };
      },
      "DELETE /api/settings/profile/avatar": document(settings({
        profile: { ...settings().profile, avatar: { ...settings().profile.avatar, hasUploadedAvatar: false } }
      }))
    }
  });
  const { page } = api;
  await page.goto("/account?returnTo=/home");
  const name = page.getByLabel("Display name");
  await expect(name).toHaveValue("Ada");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("ada@example.com");
  await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/home");

  await name.fill("  Ada Lovelace ");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect.poll(() => lastReport(page)).toBe("Profile updated.");
  await expect(name).toHaveValue("Ada Lovelace");
  const saved = api.requests.find((request) => request.key === "PATCH /api/settings/profile");
  assert.deepEqual(saved.body.data.attributes, { displayName: "Ada Lovelace" });
  assert.equal(saved.body.data.type, "user-profiles");

  await name.fill("Taken");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Name is taken.")).toBeVisible();
  // A new error array on every render keeps Vuetify's form updating past Vue's limit, which shows here as a page error.
  assert.deepEqual(api.errors, []);

  await page.getByRole("button", { name: "Remove avatar" }).click();
  await expect(page.getByRole("button", { name: "Remove avatar" })).toHaveCount(0);
  await expect.poll(() => lastReport(page)).toBe("Avatar removed.");

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByTestId("home")).toBeVisible();
  await finish(api);
});

test("saved preferences follow into the theme, the stored preference and the account locale", options, async () => {
  const api = await openApp({
    routes: {
      "PATCH /api/settings/preferences": document(settings({
        preferences: { ...settings().preferences, theme: "light", locale: "en-GB" }
      }))
    }
  });
  const { page } = api;
  await page.goto("/account");
  await expect(page.locator(".v-application.v-theme--dark")).toHaveCount(1);
  await expect(page.getByTestId("account-locale")).toHaveText("it-IT");
  assert.equal(await page.evaluate(() => localStorage.getItem("jskit.themePreference")), "dark");

  await page.getByRole("listitem").filter({ hasText: "Preferences" }).click();
  await page.waitForURL("**/account?section=preferences");
  await page.getByRole("button", { name: /Save preferences/u }).click();
  await expect.poll(() => lastReport(page)).toBe("Preferences updated.");
  const saved = api.requests.find((request) => request.key === "PATCH /api/settings/preferences");
  assert.equal(saved.body.data.type, "user-preferences");
  assert.equal(saved.body.data.attributes.avatarSize, 64);
  await expect(page.locator(".v-application.v-theme--light")).toHaveCount(1);
  await expect(page.getByTestId("account-locale")).toHaveText("en-GB");
  assert.equal(await page.evaluate(() => localStorage.getItem("jskit.themePreference")), "light");
  await finish(api);
});

test("a refused preference shows its message", options, async () => {
  const api = await openApp({
    routes: {
      "PATCH /api/settings/preferences": {
        status: 422,
        json: { error: "Validation failed.", details: { fieldErrors: { theme: "Theme is not allowed." } } }
      }
    }
  });
  const { page } = api;
  await page.goto("/account?section=preferences");
  await page.getByRole("button", { name: /Save preferences/u }).click();
  await expect(page.getByText("Theme is not allowed.")).toBeVisible();
  // The old error array looped here for seconds before Vue gave up, so the page must also stay idle.
  const busy = await busySeconds(page);
  assert.ok(busy < 0.5, `the page worked for ${busy} s of an idle second`);
  await finish(api);
});

test("notifications save, and sign-in methods link through the provider and unlink in place", options, async () => {
  const api = await openApp({
    routes: {
      "PATCH /api/settings/notifications": document(settings()),
      "DELETE /api/settings/security/oauth/google": document({
        securityStatus: { authMethods: [{ kind: "oauth", provider: "google", label: "Google", configured: false, canEnable: true }] }
      }, "user-security-settings"),
      "GET /api/settings/security/oauth/google/start": { contentType: "text/html", body: "<p>Provider</p>" }
    }
  });
  const { page } = api;
  await page.goto("/account?section=notifications");
  await page.getByRole("button", { name: /Save notification settings/u }).click();
  await expect.poll(() => lastReport(page)).toBe("Notification settings updated.");
  const saved = api.requests.find((request) => request.key === "PATCH /api/settings/notifications");
  assert.deepEqual(saved.body.data.attributes, { productUpdates: true, accountActivity: false, securityAlerts: true });

  await page.getByRole("listitem").filter({ hasText: "Sign-in methods" }).click();
  await page.getByRole("button", { name: "Unlink" }).click();
  await expect.poll(() => lastReport(page)).toBe("Sign-in method removed.");
  await expect(page.getByRole("button", { name: "Unlink" })).toHaveCount(0);
  await page.getByRole("button", { name: "Link" }).click();
  await page.getByText("Provider").waitFor();
  assert.equal(api.requests.at(-1).search, "?returnTo=%2Faccount%3Fsection%3Dsign-in-methods");
  await finish(api);
});

test("each section stays busy until its save or removal answers", options, async () => {
  const answers = {
    profile: Promise.withResolvers(),
    avatar: Promise.withResolvers(),
    preferences: Promise.withResolvers(),
    notifications: Promise.withResolvers()
  };
  const api = await openApp({
    routes: {
      "PATCH /api/settings/profile": () => answers.profile.promise,
      "DELETE /api/settings/profile/avatar": () => answers.avatar.promise,
      "PATCH /api/settings/preferences": () => answers.preferences.promise,
      "PATCH /api/settings/notifications": () => answers.notifications.promise
    }
  });
  const { page } = api;
  const loading = /v-btn--loading/u;

  await page.goto("/account");
  const name = page.getByLabel("Display name");
  const saveProfile = page.getByRole("button", { name: "Save profile" });
  const removeAvatar = page.getByRole("button", { name: "Remove avatar" });
  await expect(name).toHaveValue("Ada");
  await saveProfile.click();
  await expect(saveProfile).toHaveClass(loading);
  await expect(name).not.toBeEditable();
  await expect(removeAvatar).toBeDisabled();
  answers.profile.resolve(document(settings()));
  await expect(saveProfile).not.toHaveClass(loading);
  await expect(name).toBeEditable();

  await removeAvatar.click();
  await expect(removeAvatar).toHaveClass(loading);
  await expect(saveProfile).toBeDisabled();
  answers.avatar.resolve(document(settings()));
  await expect(removeAvatar).not.toHaveClass(loading);
  await expect(saveProfile).toBeEnabled();

  await page.getByRole("listitem").filter({ hasText: "Preferences" }).click();
  const savePreferences = page.getByRole("button", { name: /Save preferences/u });
  const disabledFields = page.locator(".v-input--disabled");
  await savePreferences.click();
  await expect(savePreferences).toHaveClass(loading);
  await expect(disabledFields).not.toHaveCount(0);
  answers.preferences.resolve(document(settings()));
  await expect(savePreferences).not.toHaveClass(loading);
  await expect(disabledFields).toHaveCount(0);

  await page.getByRole("listitem").filter({ hasText: "Notifications" }).click();
  const saveNotifications = page.getByRole("button", { name: /Save notification settings/u });
  const productUpdates = page.getByLabel("Product updates");
  await saveNotifications.click();
  await expect(saveNotifications).toHaveClass(loading);
  await expect(productUpdates).toBeDisabled();
  answers.notifications.resolve(document(settings()));
  await expect(saveNotifications).not.toHaveClass(loading);
  await expect(productUpdates).toBeEnabled();
  await finish(api);
});

test("the section list follows the address and the placements, and says when there is nothing to show", options, async () => {
  const api = await openApp();
  const { page } = api;
  await page.goto("/account?section=unknown");
  await expect(page.getByLabel("Display name")).toBeVisible();

  await page.evaluate(() => window.accountFixture.placeSection());
  await page.getByRole("listitem").filter({ hasText: "Extra" }).click();
  await page.getByText("Extra section").waitFor();
  await page.waitForURL("**/account?section=extra");
  await page.getByRole("listitem").filter({ hasText: "Profile" }).click();
  await expect(page.getByLabel("Display name")).toBeVisible();
  await page.waitForURL((url) => url.search === "");
  await finish(api);

  const empty = await openApp();
  await empty.page.goto("/account?empty");
  await expect(empty.page.getByText("No account settings sections are registered.")).toBeVisible();
  await finish(empty);
});

test("settings that fail to load offer a retry", options, async () => {
  let reads = 0;
  const api = await openApp({
    routes: {
      "GET /api/settings": () => {
        reads += 1;
        return reads === 1 ? { status: 400, json: { error: "Settings refused." } } : document(settings());
      }
    }
  });
  const { page } = api;
  await page.goto("/account");
  await expect(page.getByText("Unable to load account settings")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Ada");
  await finish(api);
});

test("ProfileClientElement presents its options, calls its actions and reports each outcome", options, async () => {
  const api = await openApp();
  const { page } = api;
  await page.goto("/profile-element");
  const root = page.getByTestId("profile-client-element");
  await expect(root).toHaveClass(
    "profile-client-element profile-client-element--layout-comfortable profile-client-element--surface-carded profile-client-element--density-comfortable profile-client-element--tone-neutral"
  );
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByText("Preview size: 64 px")).toBeVisible();
  await expect(page.getByText("AD", { exact: true })).toBeVisible();
  await expect(page.getByTestId("form-after")).toHaveText("ada@example.com");

  await page.getByLabel("Display name").fill("  Ada L ");
  await page.getByTestId("profile-submit-button").click();
  const submit = { displayName: "Ada L" };
  await expect.poll(() => page.evaluate(() => window.accountFixture.events.length)).toBe(4);
  assert.deepEqual(await page.evaluate(() => window.accountFixture.events.splice(0)), [
    { name: "profile:submit", payload: submit },
    { name: "interaction", payload: { type: "profile:submit", ...submit } },
    { name: "action:started", payload: { action: "submitProfile", payload: submit } },
    { name: "action:succeeded", payload: { action: "submitProfile", payload: submit } }
  ]);

  await page.getByTestId("profile-avatar-replace-button").click();
  await expect(page.getByText("Selected file: ada.png")).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.accountFixture.events.splice(0)), [
    { name: "avatar:replace", payload: {} },
    { name: "interaction", payload: { type: "avatar:replace" } },
    { name: "action:started", payload: { action: "openAvatarEditor", payload: {} } },
    { name: "action:succeeded", payload: { action: "openAvatarEditor", payload: {} } }
  ]);

  await page.getByTestId("profile-avatar-remove-button").click();
  await expect.poll(() => page.evaluate(() => window.accountFixture.events.length)).toBe(4);
  await expect.poll(() => api.errors.splice(0)).toEqual(["Avatar service down."]);
  assert.deepEqual((await page.evaluate(() => window.accountFixture.events.splice(0))).at(-1), {
    name: "action:failed",
    payload: { action: "submitAvatarDelete", payload: {}, message: "Avatar service down." }
  });

  await page.evaluate(() => Object.assign(window.accountFixture.profileProps, {
    copy: { saveProfile: "Keep it" },
    variant: { layout: "compact", surface: "plain", density: "compact", tone: "emphasized" },
    features: { header: false, removeAvatar: false },
    ui: { classes: { root: "custom-root", card: "custom-card" }, testIds: { root: "custom-id", submitButton: "custom-submit" } }
  }));
  const custom = page.getByTestId("custom-id");
  await expect(custom).toHaveClass(
    "profile-client-element profile-client-element--layout-compact profile-client-element--surface-plain profile-client-element--density-compact profile-client-element--tone-emphasized custom-root"
  );
  await expect(page.getByTestId("profile-client-card")).toHaveClass(/custom-card/u);
  await expect(page.getByTestId("custom-submit")).toHaveText(/Keep it/iu);
  await expect(page.getByRole("heading", { name: "Profile" })).toHaveCount(0);
  await expect(page.getByTestId("profile-avatar-remove-button")).toHaveCount(0);
  await finish(api);
});

test("ProfileClientElement shows a refused field", options, async () => {
  const api = await openApp();
  const { page } = api;
  await page.goto("/profile-element");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada");
  await page.evaluate(() => {
    window.accountFixture.profileState.profileFieldErrors.displayName = "Name is taken.";
  });
  await expect(page.getByText("Name is taken.")).toBeVisible();
  await finish(api);
});
