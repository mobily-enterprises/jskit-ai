import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspacesServerI18n } from "../src/server/i18n.js";
import { createInviterNotice } from "../src/server/workspacePendingInvitations/inviterNotice.js";

const ACCEPTANCE = Object.freeze({
  invite: { id: "60", email: "invited@example.com", workspaceId: "1", invitedByUserId: "2", roleSid: "member", tokenHash: "secret" },
  user: { id: "7", email: "other@example.com", displayName: "Olive" },
  workspace: { id: "1", slug: "acme", name: "Acme <Labs>", ownerUserId: "2" }
});

function noticeWith({ mailer, profiles = { "2": { id: "2", email: "owner@example.com", displayName: "Oscar" } } }) {
  const warnings = [];
  const reads = [];
  const notify = createInviterNotice({
    inviteMailer: mailer,
    userProfiles: { async findById(id) { reads.push(id); return profiles[id] ?? null; } },
    userSettings: { async findByUserId() { return { locale: "en" }; } },
    i18n: createWorkspacesServerI18n(),
    logger: { warn: (details, message) => warnings.push({ details, message }) }
  });
  return { notify, warnings, reads };
}

test("the inviter is sent what happened, with the facts and the email, and nothing secret", async () => {
  const sent = [];
  const { notify } = noticeWith({ mailer: { async sendWorkspaceInvite() {}, async sendInviteAcceptedByOtherAddress(notice, options) { sent.push({ notice, options }); } } });

  await notify(ACCEPTANCE, { context: "request" });

  assert.equal(sent.length, 1);
  const { message, ...facts } = sent[0].notice;
  assert.deepEqual(facts, {
    inviteId: "60",
    invite: { id: "60", email: "invited@example.com", roleSid: "member" },
    inviter: { id: "2", email: "owner@example.com", displayName: "Oscar" },
    member: { id: "7", email: "other@example.com", displayName: "Olive" },
    workspace: { id: "1", slug: "acme", name: "Acme <Labs>" },
    locale: "en"
  });
  assert.equal(message.subject, "Olive joined Acme <Labs>");
  assert.equal(message.text,
    "Olive accepted your invitation to Acme <Labs>, which you sent to invited@example.com. They joined with their account other@example.com." +
    "\n\nIf you did not expect this, remove them from the workspace's members.");
  assert.match(message.html, /<p>Olive accepted your invitation to Acme &lt;Labs&gt;,/u);
  assert.deepEqual(sent[0].options, { context: "request" });
});

test("a failed notice is logged and the acceptance stands; a mailer without it, or an inviter who is gone, sends nothing", async () => {
  const failing = noticeWith({ mailer: { async sendInviteAcceptedByOtherAddress() { throw new Error("SMTP down"); } } });
  await failing.notify(ACCEPTANCE);
  assert.equal(failing.warnings.length, 1);
  assert.equal(failing.warnings[0].message, "The inviter was not told that another address accepted their invitation.");
  assert.deepEqual(failing.warnings[0].details.inviteId, "60");

  const silent = noticeWith({ mailer: { async sendWorkspaceInvite() {} } });
  await silent.notify(ACCEPTANCE);
  assert.deepEqual(silent.reads, [], "no mailer method: nothing is read or sent");

  const sent = [];
  const gone = noticeWith({ mailer: { async sendInviteAcceptedByOtherAddress(notice) { sent.push(notice); } }, profiles: {} });
  await gone.notify(ACCEPTANCE);
  await gone.notify({ ...ACCEPTANCE, invite: { ...ACCEPTANCE.invite, invitedByUserId: null } });
  assert.deepEqual(sent, []);
  assert.deepEqual(gone.warnings, []);
});
