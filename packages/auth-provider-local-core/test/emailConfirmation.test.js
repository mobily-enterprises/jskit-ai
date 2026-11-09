import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { invitationAsGiven } from "@jskit-ai/auth-core/server/authExtensions";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { exerciseEmailConfirmation, exerciseRegistrationTakeover } from "../test-support/emailConfirmationScenario.js";

const PASSWORD = "correct horse battery staple";
const unconfirmed = { status: 403, code: AUTH_TEXTS.emailUnconfirmed.code };
const invalidCredentials = { status: 401, code: AUTH_TEXTS.invalidCredentials.code };

async function temporaryStoreDir(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-confirmation-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

async function startService(t, { env = {}, storeDir, ...overrides } = {}) {
  storeDir ??= await temporaryStoreDir(t);
  const backend = createLocalFileBackend({ storeDir });
  // "" leaves AUTH_LOCAL_EMAIL_CONFIRMATION unset: confirmation on, its default.
  const options = localServiceOptions({ env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "", ...env } });
  return { service: createLocalAuthService({ ...options, backend, ...overrides }), storeDir };
}

test("registration waits for its email to be confirmed, with a hashed, single-use, expiring link (file backend)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });
  const { service, storeDir } = await startService(t);
  assert.deepEqual(
    [service.getCapabilities().features.emailConfirmation, service.getCapabilities().features.emailConfirmationCode],
    [true, true]
  );
  await exerciseEmailConfirmation(t, service, () =>
    fs.readFile(path.join(storeDir, "registrations.passwd"), "utf8").catch(() => ""));
});

test("registering an email before or after its owner never gives its account someone else's password (file backend)", async (t) => {
  const { service } = await startService(t);
  await exerciseRegistrationTakeover(service);
});

test("AUTH_LOCAL_EMAIL_CONFIRMATION=false registers and signs in at once, and confirming is unsupported", async (t) => {
  const { service } = await startService(t, { env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });
  const registered = await service.register({ email: "ada@example.com", password: PASSWORD });
  assert.equal(registered.requiresEmailConfirmation, false);
  assert.ok(registered.session);
  assert.equal(service.getCapabilities().features.emailConfirmationCode, false);
  await assert.rejects(async () => service.confirmRegistration({ token: "any" }), { code: "AUTH_OPERATION_UNSUPPORTED" });
  await assert.rejects(async () => service.resendRegisterConfirmation({ email: "ada@example.com" }), {
    code: "AUTH_OPERATION_UNSUPPORTED"
  });
});

test("an invitation is checked on registering and given to the account its confirmation creates", async (t) => {
  const synced = [];
  const { service } = await startService(t, {
    invitationContextResolver: {
      async resolveInvitationContext(invitation) {
        if (invitation.token === "unusable") throw new Error("This invitation cannot be used.");
        return invitationAsGiven.resolveInvitationContext(invitation);
      }
    },
    profileProjector: {
      async syncIdentityProfile(profile, options) {
        synced.push({ email: profile.email, source: options.source, token: options.invitation?.token });
        return null;
      },
      async findByIdentity() {
        return null;
      }
    }
  });
  await assert.rejects(
    service.register({ email: "guest@example.com", password: PASSWORD, invitation: { token: "unusable" } }),
    /This invitation cannot be used\./u
  );
  const registered = await service.register({
    email: "guest@example.com",
    password: PASSWORD,
    invitation: { token: "invite-1", source: "workspace-invite" }
  });
  assert.deepEqual(synced, []);
  const token = new URL(registered.confirmationUrl).searchParams.get("confirmation_token");
  await service.confirmRegistration({ token, password: PASSWORD });
  assert.deepEqual(synced, [{ email: "guest@example.com", source: "workspace-invite", token: "invite-1" }]);
});

test("an invitation a feature resolved for the registering email signs in at once; any other registration still waits", async (t) => {
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  // What a feature's resolver answers for each token, as workspace invites do: the address it was sent to and its expiry.
  // A real resolver refuses another email or a lapsed invitation itself; these show local auth checks them too.
  const invitations = {
    "for-ada": { email: "Ada@Example.COM", expiresAt: later },
    "for-bob": { email: "bob@example.com", expiresAt: later },
    lapsed: { email: "cat@example.com", expiresAt: new Date(Date.now() - 1000).toISOString() },
    unaddressed: {}
  };
  const synced = [];
  const { service } = await startService(t, {
    invitationContextResolver: {
      async resolveInvitationContext({ token, source }) {
        return { token, source, ...invitations[token] };
      }
    },
    profileProjector: {
      async syncIdentityProfile(profile, options) {
        synced.push({ email: profile.email, token: options.invitation?.token });
        return null;
      },
      async findByIdentity() {
        return null;
      }
    }
  });
  const register = (email, token) =>
    service.register({ email, password: PASSWORD, ...(token && { invitation: { token, source: "workspace-invite" } }) });

  // Sent to this email, letter case aside, and not expired: the account exists at once, with its invitation.
  const invited = await register("ada@example.com", "for-ada");
  assert.equal(invited.requiresEmailConfirmation, false);
  assert.ok(invited.session.access_token);
  assert.deepEqual(synced, [{ email: "ada@example.com", token: "for-ada" }]);
  assert.equal((await service.login({ email: "ada@example.com", password: PASSWORD })).actor.email, "ada@example.com");

  // Another person's invitation, a lapsed one, one that names no email, and no invitation at all: each waits for its
  // link, and its password is refused as unconfirmed.
  for (const [email, token] of [
    ["eve@example.com", "for-bob"],
    ["cat@example.com", "lapsed"],
    ["dan@example.com", "unaddressed"],
    ["fay@example.com", null]
  ]) {
    const waiting = await register(email, token);
    assert.equal(waiting.requiresEmailConfirmation, true, email);
    assert.equal(waiting.session, null, email);
    await assert.rejects(service.login({ email, password: PASSWORD }), unconfirmed, email);
  }
  // Only the invited account has a profile: no waiting registration made one.
  assert.deepEqual([...new Set(synced.map(({ email }) => email))], ["ada@example.com"]);
});

test("an invitation passed through as given, with no feature to resolve it, still waits for its link", async (t) => {
  const { service } = await startService(t, { invitationContextResolver: invitationAsGiven });
  const waiting = await service.register({
    email: "ada@example.com",
    password: PASSWORD,
    invitation: { token: "anything", source: "workspace-invite", email: "ada@example.com" }
  });
  assert.equal(waiting.requiresEmailConfirmation, true);
  await assert.rejects(service.login({ email: "ada@example.com", password: PASSWORD }), unconfirmed);
});

test("a registration made while confirmation was on is refused as unconfirmed after it is turned off, until it registers again", async (t) => {
  const storeDir = await temporaryStoreDir(t);
  const { service: confirming } = await startService(t, { storeDir });
  assert.equal((await confirming.register({ email: "ada@example.com", password: PASSWORD })).requiresEmailConfirmation, true);

  const { service } = await startService(t, { storeDir, env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });
  await assert.rejects(service.login({ email: "ada@example.com", password: PASSWORD }), unconfirmed);
  await assert.rejects(service.login({ email: "ada@example.com", password: "a wrong password" }), invalidCredentials);
  assert.equal((await service.register({ email: "ada@example.com", password: PASSWORD })).requiresEmailConfirmation, false);
  assert.equal((await service.login({ email: "ada@example.com", password: PASSWORD })).actor.email, "ada@example.com");
});
