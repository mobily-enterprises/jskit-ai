import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/common/services/authProfileSyncService.js";

test("authProfileSyncService.syncIdentityProfile uses shared transaction for profile upsert and lifecycle contributors", async () => {
  const calls = [];
  const transaction = { trxId: "tx-1" };

  const service = createService({
    userProfilesRepository: {
      async findByIdentity(_identity, options = {}) {
        calls.push({ step: "find", trx: options.trx || null });
        return null;
      },
      async upsert(payload, options = {}) {
        calls.push({ step: "upsert", trx: options.trx || null });
        return {
          id: "13",
          authProvider: payload.authProvider,
          authProviderUserSid: payload.authProviderUserSid,
          email: payload.email,
          displayName: payload.displayName
        };
      },
      async withTransaction(work) {
        calls.push({ step: "withTransaction", trx: transaction });
        return work(transaction);
      }
    },
    userSettingsRepository: {
      async ensureForUserId(userId, options = {}) {
        calls.push({ step: "ensureUserSettings", userId: Number(userId), trx: options.trx || null });
        return { userId: Number(userId) };
      }
    },
    resolveLifecycleContributors: () => [
      {
        contributorId: "test.lifecycle",
        async afterIdentityProfileSynced({ created, options = {} } = {}) {
          calls.push({ step: "lifecycle", created, trx: options.trx || null });
        }
      }
    ]
  });

  const profile = await service.syncIdentityProfile({
    authProvider: "supabase",
    authProviderUserSid: "abc-1",
    email: "tony@example.com",
    displayName: "Tony"
  });

  assert.equal(Number(profile.id), 13);
  assert.equal(calls[0].step, "withTransaction");
  assert.equal(calls[1].step, "find");
  assert.equal(calls[2].step, "upsert");
  assert.equal(calls[3].step, "ensureUserSettings");
  assert.equal(calls[4].step, "lifecycle");
  assert.equal(calls[4].created, true);
  assert.equal(calls[1].trx, transaction);
  assert.equal(calls[2].trx, transaction);
  assert.equal(calls[3].trx, transaction);
  assert.equal(calls[4].trx, transaction);
});

test("authProfileSyncService.syncIdentityProfile skips write path when profile is unchanged", async () => {
  let upsertCalls = 0;
  let provisionCalls = 0;

  const service = createService({
    userProfilesRepository: {
      async findByIdentity() {
        return {
          id: "7",
          authProvider: "supabase",
          authProviderUserSid: "abc-7",
          email: "tony@example.com",
          displayName: "Tony"
        };
      },
      async upsert() {
        upsertCalls += 1;
        return null;
      },
      async withTransaction(work) {
        return work({ trxId: "tx-2" });
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return { userId: "7" };
      }
    },
    resolveLifecycleContributors: () => [
      {
        contributorId: "test.lifecycle",
        async afterIdentityProfileSynced({ created } = {}) {
          if (created) {
            provisionCalls += 1;
          }
        }
      }
    ]
  });

  const profile = await service.syncIdentityProfile({
    authProvider: "supabase",
    authProviderUserSid: "abc-7",
    email: "tony@example.com",
    displayName: "Tony"
  });

  assert.equal(Number(profile.id), 7);
  assert.equal(upsertCalls, 0);
  assert.equal(provisionCalls, 0);
});

test("authProfileSyncService.findByIdentity normalizes provider identity input", async () => {
  let capturedIdentity = null;
  const service = createService({
    userProfilesRepository: {
      async findByIdentity(identity) {
        capturedIdentity = identity;
        return null;
      },
      async upsert() {
        return null;
      },
      async withTransaction(work) {
        return work({ trxId: "tx-3" });
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return { userId: "1" };
      }
    }
  });

  await service.findByIdentity({
    authProvider: "  SUPABASE  ",
    authProviderUserSid: " user-1 "
  });

  assert.deepEqual(capturedIdentity, {
    provider: "supabase",
    providerUserId: "user-1"
  });
});

test("auth profile sync joins the supplied managed transaction and propagates contributor failure", async () => {
  const trx = { trxId: "managed-profile-sync" };
  const failure = new Error("Lifecycle participant failed");
  const calls = [];
  const profile = {
    id: "7", authProvider: "local", authProviderUserSid: "local-7",
    email: "ada@example.com", displayName: "Ada"
  };
  const service = createService({
    userProfilesRepository: {
      async findByIdentity(_identity, options) { calls.push(options.trx); return null; },
      async upsert(_data, options) { calls.push(options.trx); return profile; },
      async withTransaction() { throw new Error("Must join the caller's owner"); }
    },
    userSettingsRepository: {
      async ensureForUserId(_id, options) { calls.push(options.trx); }
    },
    resolveLifecycleContributors: () => [{
      async afterIdentityProfileSynced({ options }) {
        calls.push(options.trx);
        throw failure;
      }
    }]
  });
  await assert.rejects(service.syncIdentityProfile(profile, { trx }), error => error === failure);
  assert.deepEqual(calls, [trx, trx, trx, trx]);
});
