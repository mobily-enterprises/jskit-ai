import assert from "node:assert/strict";
import test from "node:test";
import { resolveHubConfig } from "../src/server/config.js";
import { createMailer } from "../src/server/mailer.js";

const MESSAGE = Object.freeze({ to: "ada@example.test", subject: "Confirm your email", text: "Open https://hub.test/confirm?token=t", html: "<p>Hi</p>" });

function recording() {
  const logs = [];
  const requests = [];
  return {
    logs,
    requests,
    logger: { info: (details, message) => logs.push({ details, message }), warn() {}, error() {}, debug() {} },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    }
  };
}

test("a test copy's hub logs each email, link included, and sends nothing, even with a sender configured", async () => {
  const { logs, requests, logger, fetchImpl } = recording();
  const mailer = createMailer({
    mail: { from: "hub@example.test", resendApiKey: "re_fixture", smtpUrl: "", live: false },
    logger,
    isProduction: true,
    fetchImpl
  });
  assert.deepEqual(await mailer.send(MESSAGE), { simulated: true });
  assert.equal(requests.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].details.sideEffects, "simulate");
  assert.match(logs[0].details.text, /token=t/u);
  assert.match(logs[0].message, /^Test copy: the accounts hub email "Confirm your email" to ada@example\.test was simulated/u);
});

test("a live hub sends through its sender", async () => {
  const { requests, logger, fetchImpl } = recording();
  const mailer = createMailer({
    mail: { from: "hub@example.test", resendApiKey: "re_fixture", smtpUrl: "", live: true },
    logger,
    isProduction: true,
    fetchImpl
  });
  assert.deepEqual(await mailer.send(MESSAGE), { simulated: false });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.resend.com/emails");
});

test("the hub's mail is live only when SIDE_EFFECTS is exactly live", () => {
  const base = {
    OIDC_HUB_REGISTRATION_TOKEN: "a-registration-token-of-enough-length",
    OIDC_HUB_OWNER_EMAIL: "owner@example.test",
    OIDC_HUB_SECRET: "x".repeat(48)
  };
  assert.equal(resolveHubConfig(base).mail.live, false);
  assert.equal(resolveHubConfig({ ...base, SIDE_EFFECTS: "Live" }).mail.live, false);
  assert.equal(resolveHubConfig({ ...base, SIDE_EFFECTS: "live" }).mail.live, true);
});
