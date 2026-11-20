import assert from "node:assert/strict";
import test from "node:test";
import { createAppEnvironmentInviteMailer } from "../src/server/workspaceMembers/appEnvironmentInviteMailer.js";

const INVITE = Object.freeze({
  inviteId: "7",
  email: "guest@example.com",
  inviteUrl: "https://app.example.test/invite?token=abc",
  message: Object.freeze({ subject: "You're invited to Books", text: "Join us", html: "<p>Join us</p>" })
});
const SERVER_NODE_ENV = Object.freeze({ NODE_ENV: "production" });

function mailerIn(env) {
  const logs = [];
  const sent = [];
  const mailer = createAppEnvironmentInviteMailer({
    env,
    logger: { info: (details, message) => logs.push({ details, message }), warn() {}, error() {}, debug() {} },
    mailer: {
      async sendWorkspaceInvite(invite, options) {
        sent.push({ invite, options });
        return { status: "sent", providerMessageId: "m-1" };
      }
    }
  });
  return { logs, sent, mailer };
}

test("development and test log each invitation, send none and report it simulated", async () => {
  for (const APP_ENV of ["development", "test"]) {
    const { logs, sent, mailer } = mailerIn({ APP_ENV });
    const delivery = await mailer.sendWorkspaceInvite(INVITE, {});
    assert.equal(delivery.status, "simulated", APP_ENV);
    assert.equal(delivery.messageCode, "workspaces.invite.simulated");
    assert.equal(sent.length, 0);
    assert.deepEqual(logs, [{
      details: {
        appEnv: APP_ENV,
        kind: "email",
        to: "guest@example.com",
        subject: "You're invited to Books",
        inviteUrl: "https://app.example.test/invite?token=abc"
      },
      message: `${APP_ENV === "test" ? "Test" : "Development"}: the workspace invitation email to guest@example.com was logged, not sent.`
    }]);
  }
});

test("staging sends an invitation for someone else only to STAGING_EMAIL_TO, saying whom it was for", async () => {
  const { logs, sent, mailer } = mailerIn({ ...SERVER_NODE_ENV, APP_ENV: "staging", STAGING_EMAIL_TO: "qa@example.test" });
  const options = { trx: null };
  assert.deepEqual(await mailer.sendWorkspaceInvite(INVITE, options), { status: "sent", providerMessageId: "m-1" });
  assert.equal(sent.length, 1);
  const [{ invite, options: passed }] = sent;
  assert.equal(passed, options);
  assert.equal(invite.email, "qa@example.test", "never to the guest");
  assert.equal(invite.inviteUrl, INVITE.inviteUrl);
  assert.deepEqual(invite.message, {
    subject: "You're invited to Books",
    text: "Staging: this email was for guest@example.com.\n\nJoin us",
    html: "<p>Staging: this email was for guest@example.com.</p><p>Join us</p>",
    headers: { "X-Staging-Original-To": "guest@example.com" }
  });
  assert.equal(logs.at(-1).message,
    "Staging: the workspace invitation email to guest@example.com was sent to qa@example.test (STAGING_EMAIL_TO) instead.");
});

test("staging without STAGING_EMAIL_TO logs each invitation, and production sends it to its address unmarked", async () => {
  const staging = mailerIn({ ...SERVER_NODE_ENV, APP_ENV: "staging" });
  assert.equal((await staging.mailer.sendWorkspaceInvite(INVITE, {})).status, "simulated");
  assert.equal(staging.sent.length, 0);
  assert.match(staging.logs[0].message, /was logged, not sent: STAGING_EMAIL_TO is not set\.$/u);

  const production = mailerIn({ ...SERVER_NODE_ENV, APP_ENV: "production", STAGING_EMAIL_TO: "qa@example.test" });
  assert.equal((await production.mailer.sendWorkspaceInvite(INVITE, {})).status, "sent");
  assert.deepEqual(production.sent[0].invite, INVITE);
});

const NOTICE = Object.freeze({
  inviteId: "7",
  invite: { id: "7", email: "guest@example.com", roleSid: "member" },
  inviter: { id: "2", email: "owner@example.com", displayName: "Olga" },
  member: { id: "9", email: "other@example.com", displayName: "Otto" },
  workspace: { id: "3", slug: "books", name: "Books" },
  locale: "en",
  message: Object.freeze({ subject: "Otto joined Books", text: "Otto accepted.", html: "<p>Otto accepted.</p>" })
});

test("the notice that another address accepted is sent as invitations are, only by a mailer that sends it", async () => {
  const noticesSent = [];
  const withNotice = createAppEnvironmentInviteMailer({
    env: { ...SERVER_NODE_ENV, APP_ENV: "staging", STAGING_EMAIL_TO: "qa@example.test" },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    mailer: {
      async sendWorkspaceInvite() {},
      async sendInviteAcceptedByOtherAddress(notice, options) {
        noticesSent.push({ notice, options });
        return { status: "sent" };
      }
    }
  });
  assert.deepEqual(await withNotice.sendInviteAcceptedByOtherAddress(NOTICE, { context: "c" }), { status: "sent" });
  assert.equal(noticesSent.length, 1);
  assert.equal(noticesSent[0].notice.inviter.email, "qa@example.test", "staging sends it to STAGING_EMAIL_TO");
  assert.match(noticesSent[0].notice.message.text, /^Staging: this email was for owner@example\.com\./u);
  assert.deepEqual(noticesSent[0].options, { context: "c" });

  const { mailer: withoutNotice } = mailerIn({ APP_ENV: "development" });
  assert.equal(Object.hasOwn(withoutNotice, "sendInviteAcceptedByOtherAddress"), false);
});
