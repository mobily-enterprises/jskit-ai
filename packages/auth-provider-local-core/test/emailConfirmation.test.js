import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { invitationAsGiven } from "@jskit-ai/auth-core/server/authExtensions";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { exerciseEmailConfirmation, exerciseRegistrationTakeover } from "../test-support/emailConfirmationScenario.js";

const PASSWORD = "correct horse battery staple";

async function startService(t, { env = {}, ...overrides } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-confirmation-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
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
