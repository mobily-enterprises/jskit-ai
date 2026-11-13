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
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalAuthService, createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { createPassIssuer, passIdentityByEmail, passwordlessAccount } from "../../auth-provider-local-core/test-support/passSignInScenario.js";
import {
  createChromiumLaunchOptions,
  reservePort,
  startViteFixture,
  stopProcess
} from "../../../tooling/testUtils/browserFixture.mjs";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";

// The real sign-in page and app, served on http://localhost:PORT, with the real auth routes, auth policy and local
// auth behind its /api, trusting a pass issuer whose page is on 127.0.0.1, another site. The issuer's page posts a
// pass to the app's pass sign-in route as a form, as an issuer opening the app for its person does. Cookies are
// SameSite=Strict, the setting under which a cross-site arrival carries the fewest.
const RUN = process.env.JSKIT_AUTH_WEB_BROWSER_INTEGRATION === "1";
const options = { skip: !RUN, timeout: 120_000 };
const STRICT = Object.freeze({ AUTH_COOKIE_SAME_SITE: "strict" });
const SESSION_COOKIES = ["jskit_local_access_token", "jskit_local_refresh_token"];

let stack = null;
const cleanups = [];

before(async () => {
  if (!RUN) return;
  const vitePort = await reservePort();
  const appUrl = `http://localhost:${vitePort}`;
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-pass-"));
  cleanups.push(() => fs.rm(storeDir, { recursive: true, force: true }));
  const issuer = createPassIssuer();
  const env = { ...issuer.env, ...STRICT };
  const backend = createLocalFileBackend({ storeDir });
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const authService = createLocalAuthService({
    ...localServiceOptions({ env: { APP_PUBLIC_URL: appUrl, ...env } }),
    backend,
    passIdentity: passIdentityByEmail(backend)
  });

  const api = Fastify();
  cleanups.push(() => api.close());
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService,
      "runtime.config": {},
      "runtime.env": { NODE_ENV: "test", ...env },
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
  stack = { appUrl, issuer, browser };
});

after(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup();
  }
});

function cookieNames(header) {
  return String(header || "").split(";").map((pair) => pair.split("=")[0].trim()).filter(Boolean).sort();
}

/** The issuer's page on 127.0.0.1, which posts the pass to the app as soon as it loads. */
async function startIssuerPage(t, pass) {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><title>Opening the app</title>
<form method="post" action="${stack.appUrl}/api/login/pass"><input type="hidden" name="pass" value="${pass}"></form>
<script>document.forms[0].submit();</script>`);
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

/** A browser of its own, which records every page it loads with the method and headers it sent. */
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
      documents.push({ url: new URL(request.url()), method: request.method(), headers: request.allHeaders() });
    }
  });
  return { context, page, documents, errors };
}

test("a pass the issuer's page posts from another site signs its person in on the app, with no password", options, async (t) => {
  const pass = stack.issuer.pass("ada@example.com");
  const issuerPage = await startIssuerPage(t, pass);
  const { context, page, documents, errors } = await openBrowser(t);

  await page.goto(issuerPage);
  await expect(page.getByTestId("home")).toHaveText("Signed in: true");
  assert.equal(new URL(page.url()).pathname, "/home");

  // The pass arrived as a cross-site form post, carrying none of the app's cookies, and set the session's.
  const posts = documents.filter(({ url, method }) => method === "POST" && url.pathname === "/api/login/pass");
  assert.equal(posts.length, 1);
  const postHeaders = await posts[0].headers;
  assert.equal(postHeaders["sec-fetch-site"], "cross-site");
  assert.deepEqual(cookieNames(postHeaders.cookie), []);
  const kept = (await context.cookies(stack.appUrl)).filter(({ name }) => SESSION_COOKIES.includes(name));
  assert.deepEqual(kept.map(({ name, sameSite, httpOnly }) => [name, sameSite, httpOnly]).sort(),
    SESSION_COOKIES.map((name) => [name, "Strict", true]));
  assert.deepEqual(errors, []);
});

test("the same pass posted again, from another browser, and an expired pass land on the sign-in page saying why", options, async (t) => {
  const pass = stack.issuer.pass("ada@example.com");
  const first = await openBrowser(t);
  await first.page.goto(await startIssuerPage(t, pass));
  await expect(first.page.getByTestId("home")).toHaveText("Signed in: true");

  // The sign-in page reports why to the shell, whose banner shows it (the fixture's shell keeps the reports).
  const { context, page, errors } = await openBrowser(t);
  const lastReport = () => page.evaluate(() => window.authFixture.reports.at(-1)?.message);
  await page.goto(await startIssuerPage(t, pass));
  await page.waitForURL((url) => url.pathname === "/auth/login");
  await expect.poll(lastReport).toBe("This sign-in pass was already used. Open the app again from where you came.");

  await page.goto(await startIssuerPage(t, stack.issuer.pass("ada@example.com", { now: Date.now() - 91_000 })));
  await page.waitForURL((url) => url.pathname === "/auth/login");
  await expect.poll(lastReport).toBe("This sign-in pass has expired. Open the app again from where you came.");

  const signedIn = (await context.cookies(stack.appUrl)).filter(({ name }) => SESSION_COOKIES.includes(name));
  assert.deepEqual(signedIn, []);
  assert.deepEqual(errors, []);
});
