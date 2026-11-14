import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDevelopmentOnlySettings,
  deliverMessage,
  logSideEffect,
  markStagingEmail
} from "./appEnvironment.js";

const STAGING = Object.freeze({ APP_ENV: "staging", NODE_ENV: "production" });

function recordingLogger() {
  const lines = [];
  const record = (level) => (details, message) => lines.push({ level, details, message });
  return { lines, debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
}

/** Sends one email the way local auth or the accounts hub would, recording where each one went. */
async function sendEmail(env, to = "ada@example.com") {
  const logger = recordingLogger();
  const sent = [];
  const delivery = await deliverMessage({
    env,
    logger,
    channel: "email",
    to,
    summary: `the password reset email to ${to}`,
    details: { link: "https://app.example/reset" },
    send: async (recipient, routing) => {
      sent.push({ recipient, ...routing });
      return "message-1";
    }
  });
  return { delivery, sent, lines: logger.lines };
}

test("a development-only setting stops a staging or production server, saying what to do", () => {
  assert.throws(() => assertDevelopmentOnlySettings({ ...STAGING, DEV_OUTPUT: "log" }, ["DEV_OUTPUT", "OTHER"]), {
    message: "DEV_OUTPUT is for development only and APP_ENV is staging. Remove it from the staging environment."
  });
  assert.throws(() => assertDevelopmentOnlySettings({ APP_ENV: "production", A: "1", B: "2" }, ["A", "B"]),
    { message: /^A, B are for development only and APP_ENV is production\. Remove them from the production/u });
  assert.doesNotThrow(() => assertDevelopmentOnlySettings({ ...STAGING, DEV_OUTPUT: " " }, ["DEV_OUTPUT"]));
  assert.doesNotThrow(() => assertDevelopmentOnlySettings({ APP_ENV: "development", DEV_OUTPUT: "log" }, ["DEV_OUTPUT"]));
  assert.doesNotThrow(() => assertDevelopmentOnlySettings(
    { APP_ENV: "test", NODE_ENV: "production", DEV_OUTPUT: "log" }, ["DEV_OUTPUT"]), "NODE_ENV decides nothing");
  assert.throws(() => assertDevelopmentOnlySettings({ DEV_OUTPUT: "log" }, ["DEV_OUTPUT"]), { message: /^APP_ENV is not set/u });
});

test("staging sends an email meant for someone else only to STAGING_EMAIL_TO, logging who it was for", async () => {
  const { delivery, sent, lines } = await sendEmail({ ...STAGING, STAGING_EMAIL_TO: "qa@example.com" });
  assert.deepEqual(sent, [{ recipient: "qa@example.com", originalTo: "ada@example.com" }], "never to ada");
  assert.deepEqual(delivery, { sent: true, to: "qa@example.com", originalTo: "ada@example.com", result: "message-1" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].message,
    "Staging: the password reset email to ada@example.com was sent to qa@example.com (STAGING_EMAIL_TO) instead.");
  assert.deepEqual(lines[0].details, {
    appEnv: "staging", kind: "email", to: "qa@example.com", originalTo: "ada@example.com", link: "https://app.example/reset"
  });
});

test("staging without STAGING_EMAIL_TO logs the email and sends nothing; SMS follows STAGING_SMS_TO alone", async () => {
  const { delivery, sent, lines } = await sendEmail({ ...STAGING, STAGING_SMS_TO: "+61400000000" });
  assert.deepEqual(sent, []);
  assert.deepEqual(delivery, { sent: false });
  assert.equal(lines[0].message,
    "Staging: the password reset email to ada@example.com was logged, not sent: STAGING_EMAIL_TO is not set.");
  assert.deepEqual(lines[0].details, { appEnv: "staging", kind: "email", to: "ada@example.com", link: "https://app.example/reset" });

  const texts = [];
  const sms = await deliverMessage({
    env: { ...STAGING, STAGING_EMAIL_TO: "qa@example.com", STAGING_SMS_TO: "+61400000000" },
    logger: recordingLogger(),
    channel: "sms",
    to: "+61411111111",
    summary: "the sign-in code to +61411111111",
    send: async (recipient, routing) => texts.push({ recipient, ...routing })
  });
  assert.deepEqual(texts, [{ recipient: "+61400000000", originalTo: "+61411111111" }]);
  assert.equal(sms.to, "+61400000000");
});

test("development and test log every email; production sends it to its recipient", async () => {
  for (const APP_ENV of ["development", "test"]) {
    const { delivery, sent, lines } = await sendEmail({ APP_ENV, STAGING_EMAIL_TO: "qa@example.com" });
    assert.deepEqual(sent, [], APP_ENV);
    assert.deepEqual(delivery, { sent: false });
    const label = APP_ENV === "test" ? "Test" : "Development";
    assert.equal(lines[0].message, `${label}: the password reset email to ada@example.com was logged, not sent.`);
  }
  const { delivery, sent, lines } = await sendEmail({ APP_ENV: "production", NODE_ENV: "production", STAGING_EMAIL_TO: "qa@example.com" });
  assert.deepEqual(sent, [{ recipient: "ada@example.com", originalTo: "" }]);
  assert.equal(delivery.result, "message-1");
  assert.deepEqual(lines, []);
  await assert.rejects(sendEmail({}), { message: /^APP_ENV is not set/u });
  await assert.rejects(deliverMessage({ env: STAGING, channel: "push", send: async () => {} }), {
    name: "TypeError", message: "deliverMessage sends email or sms, not push."
  });
});

test("an email staging redirected shows who it was for in its text, its HTML and a header", () => {
  const email = { subject: "Reset", text: "Follow the link.", html: "<html><body class=\"m\"><p>Follow</p></body></html>" };
  assert.equal(markStagingEmail(email, ""), email, "a real email is unchanged");
  const marked = markStagingEmail({ ...email, headers: { "X-Other": "1" } }, "ada@example.com");
  assert.equal(marked.text, "Staging: this email was for ada@example.com.\n\nFollow the link.");
  assert.equal(marked.html, "<html><body class=\"m\"><p>Staging: this email was for ada@example.com.</p><p>Follow</p></body></html>");
  assert.deepEqual(marked.headers, { "X-Other": "1", "X-Staging-Original-To": "ada@example.com" });
  assert.equal(markStagingEmail({ html: "<p>Hi</p>" }, "<x>@example.com").html,
    "<p>Staging: this email was for &#60;x&#62;@example.com.</p><p>Hi</p>");
});

test("a logged side effect names the environment, and staging says only production acts for real", () => {
  const logger = recordingLogger();
  logSideEffect(logger, "staging", { kind: "push notification", summary: "the reminder to device 4", details: { device: 4 } });
  logSideEffect(logger, "test", { kind: "connector operation", summary: "the stripe charge request" });
  assert.deepEqual(logger.lines.map(({ message }) => message), [
    "Staging: the reminder to device 4 was logged, not sent: only production acts for real.",
    "Test: the stripe charge request was logged, not sent."
  ]);
  assert.deepEqual(logger.lines[0].details, { appEnv: "staging", kind: "push notification", device: 4 });
});
