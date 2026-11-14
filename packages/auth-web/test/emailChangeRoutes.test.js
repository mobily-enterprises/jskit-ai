import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { emailChangeService } from "../../auth-provider-local-core/test-support/emailChangeScenario.js";
import { sessionCookies } from "../../auth-provider-local-core/test-support/oauthHarness.js";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";
import { DEFAULT_AUTH_RATE_LIMITS } from "../src/server/authRateLimits.js";

const PASSWORD = "correct horse battery staple";

/** The auth routes over local auth in a store of the test's own, whose email-change sender keeps what it sends. */
async function startApp(t, config = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-email-change-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const { service, takeSent } = emailChangeService(createLocalFileBackend({ storeDir }));
  const app = Fastify();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": service,
      "runtime.config": config,
      "runtime.env": { APP_ENV: "test" },
      "runtime.fastify": app,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider, AuthWebFeature]
  });
  await runtime.start();
  t.after(async () => {
    await runtime.shutdown();
    await app.close();
  });
  return { app, service, takeSent };
}

/** A browser: its cookies and CSRF token, signed in as the email when one is given. */
async function browser(app, service, email = "") {
  const cookies = email
    ? sessionCookies((await service.register({ email, password: PASSWORD })).session)
    : {};
  const session = await app.inject({ method: "GET", url: "/api/session", cookies });
  for (const cookie of session.cookies) {
    cookies[cookie.name] = cookie.value;
  }
  const csrfToken = session.json().csrfToken;
  return (url, payload) => app.inject({ method: "POST", url, cookies, headers: { "csrf-token": csrfToken }, payload });
}

test("the signed-in person asks to change their email, and the link's page confirms it signed in or not", async (t) => {
  const { app, service, takeSent } = await startApp(t);
  const ada = await browser(app, service, "ada@example.com");
  const stranger = await browser(app, service);

  const refused = async (response, status, code) => {
    assert.equal(response.statusCode, status, response.body);
    assert.equal(response.json().code, code);
  };
  await refused(await stranger("/api/email-change", { email: "new@example.com", password: PASSWORD }), 401, "auth.session.required");
  await refused(await ada("/api/email-change", { email: "new@example.com", password: "a wrong password" }), 400,
    "auth.local.emailChange.passwordInvalid");
  await refused(await ada("/api/email-change", { email: "new@example.com" }), 400, "validation_failed");
  assert.deepEqual(await takeSent(), []);

  const asked = await ada("/api/email-change", { email: "new@example.com", password: PASSWORD });
  assert.equal(asked.statusCode, 200, asked.body);
  assert.deepEqual(asked.json(), { ok: true, email: "new@example.com" });
  const [link] = await takeSent();
  const token = new URL(link.confirmationUrl).searchParams.get("token");

  await refused(await stranger("/api/email-change/confirm", {}), 400, "validation_failed");
  const confirmed = await stranger("/api/email-change/confirm", { token });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.deepEqual(confirmed.json(), { ok: true, email: "new@example.com" });
  await refused(await stranger("/api/email-change/confirm", { token }), 400, "auth.local.emailChange.linkInvalid");
  assert.equal((await service.login({ email: "new@example.com", password: PASSWORD })).actor.email, "new@example.com");
});

test("asking for an email change, and confirming one, are each limited per address", async (t) => {
  assert.deepEqual([DEFAULT_AUTH_RATE_LIMITS.emailChange, DEFAULT_AUTH_RATE_LIMITS.emailChangeConfirm],
    [{ max: 5, timeWindow: "1 minute" }, { max: 10, timeWindow: "1 minute" }]);
  const { app, service } = await startApp(t, {
    auth: { rateLimits: { emailChange: { max: 2 }, emailChangeConfirm: { max: 2 } } }
  });
  const ada = await browser(app, service, "ada@example.com");
  const asked = [];
  const confirmed = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    asked.push((await ada("/api/email-change", { email: "new@example.com", password: "a wrong password" })).statusCode);
    confirmed.push((await ada("/api/email-change/confirm", { token: "not-a-link" })).statusCode);
  }
  assert.deepEqual(asked, [400, 400, 429]);
  assert.deepEqual(confirmed, [400, 400, 429]);
});
