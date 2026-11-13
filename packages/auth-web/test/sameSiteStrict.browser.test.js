import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import Fastify from "fastify";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { createService, oidcProviderEntry, startOidcProvider } from "../../auth-provider-local-core/test-support/oauthHarness.js";
import {
  createChromiumLaunchOptions,
  reservePort,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";

// The real sign-in page, served on http://localhost:PORT, with the real auth routes, auth policy and local auth behind
// its /api, all with AUTH_COOKIE_SAME_SITE=strict. The Google stand-in and the webmail page are on 127.0.0.1, another
// site, and the way back from either starts on its own page (the stand-in's Continue button, the webmail's link), so
// it is a cross-site navigation, on which a browser sends no SameSite=Strict cookie. (Chromium still sends them when
// the provider only redirects the app's own navigation back, without a page of its own.)
const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const STRICT = Object.freeze({ AUTH_COOKIE_SAME_SITE: "strict" });
const PASSWORD = "correct horse battery staple";
const SESSION_COOKIES = ["_csrf", "jskit_local_access_token", "jskit_local_refresh_token"];

let stack = null;
const cleanups = [];

before(async () => {
  if (!RUN) return;
  const vitePort = await reservePort();
  const appUrl = `http://localhost:${vitePort}`;
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-same-site-"));
  cleanups.push(() => fs.rm(storeDir, { recursive: true, force: true }));
  const issuer = await startOidcProvider({ appUrl, consentPage: true });
  cleanups.push(() => issuer.close());
  const authService = createService({
    backend: createLocalFileBackend({ storeDir }),
    oauthProviders: [oidcProviderEntry(issuer)],
    profileProjector: noAppProfiles,
    env: { APP_PUBLIC_URL: appUrl, ...STRICT }
  });

  const api = Fastify();
  cleanups.push(() => api.close());
  // What reaches the server: each request with the names of the cookies it carried.
  const apiRequests = [];
  api.addHook("onRequest", async (request) => {
    apiRequests.push({ key: `${request.method} ${request.url.split("?")[0]}`, cookies: cookieNames(request.headers.cookie) });
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService,
      "runtime.config": {},
      "runtime.env": { NODE_ENV: "test", ...STRICT },
      "runtime.fastify": api,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider,
      AuthWebFeature]
  });
  await runtime.start();
  cleanups.push(() => runtime.shutdown());
  await api.listen({ host: "127.0.0.1", port: 0 });

  const vite = await startViteFixture({
    fixtureRoot: fileURLToPath(new URL("../fixtures/sign-in/", import.meta.url)),
    port: vitePort,
    env: { JSKIT_AUTH_WEB_FIXTURE_API_SERVER: `http://127.0.0.1:${api.server.address().port}` }
  });
  cleanups.push(() => stopProcess(vite));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  cleanups.push(() => browser.close());
  stack = { appUrl, issuerUrl: issuer.issuer, authService, apiRequests, browser };
});

after(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup();
  }
});

function cookieNames(header) {
  return String(header || "").split(";").map((pair) => pair.split("=")[0].trim()).filter(Boolean).sort();
}

/** A browser of its own, which records every page it loads with the headers it sent. */
async function openBrowser(t) {
  const context = await stack.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const documents = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documents.push({ url: new URL(request.url()), headers: request.allHeaders() });
    }
  });
  return { context, page, documents, errors };
}

/** The headers of the one page load of the app that `matches` its address. */
async function appDocument(documents, matches) {
  const loads = documents.filter(({ url }) => url.origin === new URL(stack.appUrl).origin && matches(url));
  assert.equal(loads.length, 1, `page loads: ${documents.map(({ url }) => url.href).join(", ")}`);
  return loads[0].headers;
}

function apiRequest(key) {
  const requests = stack.apiRequests.filter((request) => request.key === key);
  assert.equal(requests.length > 0, true, `no ${key} among ${stack.apiRequests.map((request) => request.key).join(", ")}`);
  return requests;
}

test("with strict cookies, Google sign-in comes back from the provider's site and completes on the login page", options, async (t) => {
  const { context, page, documents, errors } = await openBrowser(t);
  const attemptSetCookies = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/oauth/google/start") {
      attemptSetCookies.push(response.headersArray());
    }
  });
  stack.apiRequests.length = 0;
  await page.goto(`${stack.appUrl}/auth/login?returnTo=/home`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL((url) => url.href.startsWith(stack.issuerUrl));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");
  assert.equal(new URL(page.url()).pathname, "/home");

  // The start set the attempt cookie Strict, before the browser left for the provider.
  const [startHeaders] = await Promise.all(attemptSetCookies);
  const attemptCookie = startHeaders.find(({ name, value }) => name.toLowerCase() === "set-cookie" &&
    value.startsWith("jskit_local_oauth_attempt="));
  assert.match(attemptCookie.value, /; SameSite=Strict(;|$)/u);

  // The way back to the login page started on the provider's page, a cross-site navigation, so it carried none of the
  // app's cookies: neither the attempt nor the CSRF secret the login page had been given.
  const back = await appDocument(documents, (url) => url.pathname === "/auth/login" && url.searchParams.has("code"));
  assert.equal(back["sec-fetch-site"], "cross-site");
  assert.deepEqual(cookieNames(back.cookie), []);
  // The page's own same-origin POST carried the attempt, which completed the sign-in.
  assert.deepEqual(apiRequest("POST /api/oauth/complete").map(({ cookies }) => cookies), [
    ["_csrf", "jskit_local_oauth_attempt"]
  ]);
  assert.deepEqual(apiRequest("GET /api/session").at(-1).cookies, SESSION_COOKIES);

  const kept = (await context.cookies(stack.appUrl)).map(({ name, sameSite }) => [name, sameSite]);
  assert.deepEqual(kept.sort(), SESSION_COOKIES.map((name) => [name, "Strict"]));
  assert.deepEqual(errors, []);
});

/** A webmail page on 127.0.0.1, another site than the app's, with one link into the app. */
async function startWebmail(t, link) {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><title>Inbox</title><a href="${link}">Open your account</a>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

test("with strict cookies, a link from another site opens the app signed in by the page's own requests", options, async (t) => {
  await stack.authService.register({ email: "grace@example.com", password: PASSWORD });
  const webmail = await startWebmail(t, `${stack.appUrl}/home`);
  const { page, documents, errors } = await openBrowser(t);
  await page.goto(`${stack.appUrl}/auth/login?returnTo=/home`);
  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");

  stack.apiRequests.length = 0;
  documents.length = 0;
  await page.goto(webmail);
  await page.getByRole("link", { name: "Open your account" }).click();
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");
  // The link's page load came from another site and carried no Strict cookie ...
  const landing = await appDocument(documents, (url) => url.pathname === "/home");
  assert.equal(landing["sec-fetch-site"], "cross-site");
  assert.deepEqual(cookieNames(landing.cookie), []);
  // ... and the page's own requests carried them all, so the person is signed in.
  for (const { cookies } of apiRequest("GET /api/session")) {
    assert.deepEqual(cookies, SESSION_COOKIES);
  }

  // A page load the person starts in the app carries them, so the empty Cookie header above is SameSite at work.
  documents.length = 0;
  await page.goto(`${stack.appUrl}/home`);
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");
  const typed = await appDocument(documents, (url) => url.pathname === "/home");
  assert.equal(typed["sec-fetch-site"], "none");
  assert.deepEqual(cookieNames(typed.cookie), SESSION_COOKIES);
  assert.deepEqual(errors, []);
});
