import assert from "node:assert/strict";
import test from "node:test";
import { resolveHubConfig } from "../src/server/config.js";
import { createMailer } from "../src/server/mailer.js";

const MESSAGE = Object.freeze({ to: "ada@example.test", subject: "Confirm your email", text: "Open https://hub.test/confirm?token=t", html: "<body><p>Hi</p></body>" });
const MAIL = Object.freeze({ from: "hub@example.test", resendApiKey: "re_fixture", smtpUrl: "" });
const STAGING = Object.freeze({ APP_ENV: "staging", NODE_ENV: "production" });

function recording() {
  const logs = [];
  const requests = [];
  return {
    logs,
    requests,
    logger: { info: (details, message) => logs.push({ details, message }), warn() {}, error() {}, debug() {} },
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200 };
    }
  };
}

function mailerIn(env) {
  const recorded = recording();
  return { ...recorded, mailer: createMailer({ mail: MAIL, env, logger: recorded.logger, fetchImpl: recorded.fetchImpl }) };
}

test("a development or test hub logs each email, link included, and sends nothing, even with a sender configured", async () => {
  for (const APP_ENV of ["development", "test"]) {
    const { logs, requests, mailer } = mailerIn({ APP_ENV });
    assert.deepEqual(await mailer.send(MESSAGE), { simulated: true });
    assert.equal(requests.length, 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].details.appEnv, APP_ENV);
    assert.match(logs[0].details.text, /token=t/u);
    assert.match(logs[0].message, /^(Development|Test): the accounts hub email "Confirm your email" to ada@example\.test was logged, not sent\.$/u);
  }
});

test("a staging hub sends an email for someone else only to STAGING_EMAIL_TO, saying who it was for", async () => {
  const { logs, requests, mailer } = mailerIn({ ...STAGING, STAGING_EMAIL_TO: "qa@example.test" });
  assert.deepEqual(await mailer.send(MESSAGE), { simulated: false });
  assert.equal(requests.length, 1);
  const { body } = requests[0];
  assert.deepEqual(body.to, ["qa@example.test"], "never to ada");
  assert.equal(body.headers["X-Staging-Original-To"], "ada@example.test");
  assert.match(body.text, /^Staging: this email was for ada@example\.test\.\n\nOpen https/u);
  assert.equal(body.html, "<body><p>Staging: this email was for ada@example.test.</p><p>Hi</p></body>");
  assert.equal(logs[0].message,
    "Staging: the accounts hub email \"Confirm your email\" to ada@example.test was sent to qa@example.test (STAGING_EMAIL_TO) instead.");
});

test("a staging hub without STAGING_EMAIL_TO logs each email and sends nothing", async () => {
  const { logs, requests, mailer } = mailerIn(STAGING);
  assert.deepEqual(await mailer.send(MESSAGE), { simulated: true });
  assert.equal(requests.length, 0);
  assert.match(logs[0].message, /was logged, not sent: STAGING_EMAIL_TO is not set\.$/u);
});

test("a production hub sends each email to its recipient, unmarked", async () => {
  const { requests, mailer } = mailerIn({ APP_ENV: "production", NODE_ENV: "production", STAGING_EMAIL_TO: "qa@example.test" });
  assert.deepEqual(await mailer.send(MESSAGE), { simulated: false });
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.deepEqual(requests[0].body.to, ["ada@example.test"]);
  assert.equal(requests[0].body.headers, undefined);
  assert.equal(requests[0].body.text, MESSAGE.text);
});

test("a staging or production hub needs a sender; development and test start without one", () => {
  const base = {
    OIDC_HUB_REGISTRATION_TOKEN: "a-registration-token-of-enough-length",
    OIDC_HUB_OWNER_EMAIL: "owner@example.test",
    OIDC_HUB_SECRET: "x".repeat(48),
    APP_PUBLIC_URL: "https://hub.example.test"
  };
  for (const APP_ENV of ["staging", "production"]) {
    assert.throws(() => resolveHubConfig({ ...base, APP_ENV }), { message: /^Set OIDC_HUB_EMAIL_FROM/u }, APP_ENV);
  }
  for (const APP_ENV of ["development", "test"]) {
    assert.equal(resolveHubConfig({ ...base, APP_ENV, NODE_ENV: "production" }).isDeployed, false, APP_ENV);
  }
  assert.throws(() => resolveHubConfig(base), { message: /^APP_ENV is not set/u });
});
