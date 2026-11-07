import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
