import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService as createProfileSyncService } from "../../users-core/src/server/common/services/authProfileSyncService.js";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";

// Records how each synchronization was asked for: in full, or only when the profile changed.
function recordingProjector() {
  const syncs = [];
  let profile = null;
  return {
    syncs,
    async syncIdentityProfile(identity, options = {}) {
      syncs.push(options.onlyWhenChanged ? "when changed" : "full");
      profile = { ...identity, id: "1" };
      return profile;
    },
    async findByIdentity() {
      return profile;
    }
  };
}

async function startService(t, profileProjector) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-profile-sync-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return createLocalAuthService({ ...localServiceOptions(), backend: createLocalFileBackend({ storeDir }), profileProjector });
}

async function signedInCookies(service) {
  await service.register({ email: "ada@example.com", password: "correct horse" });
  return sessionCookies((await service.login({ email: "ada@example.com", password: "correct horse" })).session);
}

test("a display name change answers the synchronized app profile, so users-core does not write it again", async (t) => {
  const projector = recordingProjector();
  const service = await startService(t, projector);
  const cookies = await signedInCookies(service);
  const changed = await service.updateDisplayName({ cookies }, { displayName: "Ada Lovelace" });
  assert.equal(changed.profile.id, "1");
  assert.equal(changed.profile.displayName, "Ada Lovelace");
  assert.equal(changed.actor.appUserId, "1");
});

test("an ordinary request synchronizes its profile only when it changed; sign-in, a session refresh and a name change synchronize in full", async (t) => {
  const projector = recordingProjector();
  const service = await startService(t, projector);
  await service.register({ email: "ada@example.com", password: "correct horse" });
  projector.syncs.length = 0;
  const signedIn = await service.login({ email: "ada@example.com", password: "correct horse" });
  assert.deepEqual(projector.syncs.splice(0), ["full"]);
  const cookies = sessionCookies(signedIn.session);

  // Each ordinary request still reads its session and user; its profile is synchronized only when it changed.
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await service.authenticateRequest({ cookies })).authenticated, true);
  }
  await service.getSecurityStatus({ cookies });
  assert.deepEqual(projector.syncs.splice(0), ["when changed", "when changed", "when changed", "when changed"]);

  // A session refresh (the access token has expired) issues new tokens and synchronizes in full.
  const refreshed = await service.authenticateRequest({ cookies: { jskit_local_refresh_token: cookies.jskit_local_refresh_token } });
  assert.equal(refreshed.authenticated, true);
  assert.ok(refreshed.session?.access_token);
  assert.deepEqual(projector.syncs.splice(0), ["full"]);

  // A display name change authenticates like a request, then synchronizes the new name in full.
  await service.updateDisplayName({ cookies }, { displayName: "Ada Lovelace" });
  assert.deepEqual(projector.syncs.splice(0), ["when changed", "full"]);

  // Authorization rests on the session read, not on the profile: signing out ends the next ordinary request.
  await service.logout({ cookies });
  assert.equal((await service.authenticateRequest({ cookies })).authenticated, false);
});

// users-core's profile projector over in-memory repositories; its lifecycle contributor stands where workspaces-core
// provisions the personal workspace (re-creating one that was deleted).
function usersProfileSync() {
  const profiles = [];
  const provisioned = [];
  const profileProjector = createProfileSyncService({
    userProfilesRepository: {
      async findByIdentity(identity) {
        return profiles.find((profile) => profile.authProviderUserSid === identity.providerUserId) || null;
      },
      async upsert(payload) {
        const existing = profiles.find((profile) => profile.authProviderUserSid === payload.authProviderUserSid);
        if (existing) return Object.assign(existing, payload);
        const profile = { id: String(profiles.length + 1), ...payload };
        profiles.push(profile);
        return profile;
      },
      async withTransaction(work) {
        return work({});
      }
    },
    userSettingsRepository: {
      async ensureForUserId(userId) {
        return { userId };
      }
    },
    resolveLifecycleContributors: () => [{
      contributorId: "workspaces.provisioning",
      async afterIdentityProfileSynced({ profile }) {
        provisioned.push(profile.displayName);
      }
    }]
  });
  return { profileProjector, profiles, provisioned };
}

test("with users-core, a name changed at the provider shows at the next request, and provisioning runs again at the next refresh", async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-profile-sync-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  const users = usersProfileSync();
  const service = createLocalAuthService({ ...localServiceOptions(), backend, profileProjector: users.profileProjector });
  await service.register({ email: "ada@example.com", password: "correct horse" });
  const signedIn = await service.login({ email: "ada@example.com", password: "correct horse" });
  const cookies = sessionCookies(signedIn.session);
  users.provisioned.length = 0;

  // An ordinary request with a matching profile only reads it: no provisioning.
  assert.equal((await service.authenticateRequest({ cookies })).actor.appUserId, "1");
  assert.deepEqual(users.provisioned, []);

  // A name changed at the provider (the local user store, outside the app) is synchronized by the next request.
  await backend.withTransaction((tx) => tx.users.updateProfile(signedIn.actor.providerUserId, { displayName: "Ada Lovelace" }));
  assert.equal((await service.authenticateRequest({ cookies })).actor.displayName, "Ada Lovelace");
  assert.equal(users.profiles[0].displayName, "Ada Lovelace");
  assert.deepEqual(users.provisioned.splice(0), ["Ada Lovelace"]);

  // A deleted personal workspace is provisioned again at the next session refresh, not at the next request.
  await service.authenticateRequest({ cookies });
  assert.deepEqual(users.provisioned, []);
  const refreshed = await service.authenticateRequest({ cookies: { jskit_local_refresh_token: cookies.jskit_local_refresh_token } });
  assert.ok(refreshed.session?.access_token);
  assert.deepEqual(users.provisioned, ["Ada Lovelace"]);
});
