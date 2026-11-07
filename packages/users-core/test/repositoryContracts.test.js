import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS } from "../src/shared/settings.js";
import { userProfileResource } from "../src/shared/resources/userProfileResource.js";
import { createRepository as createUserProfilesRepository } from "../src/server/common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
}

test("users-core repositories delegate transaction ownership and failures to the API", async () => {
  const api = {
    async transaction(work) {
      return work({ trxId: "managed-1" });
    },
    resources: {
      userProfiles: {
        async query() {
          return asCollectionDocument([]);
        }
      },
      userSettings: {
        async query() {
          return asCollectionDocument([]);
        }
      }
    }
  };
  const repositories = [
    createUserProfilesRepository({ api }),
    createUserSettingsRepository({ api })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "managed-1" });
    const failure = new Error("Participant failed");
    await assert.rejects(repository.withTransaction(async () => { throw failure; }), error => error === failure);
  }
});

function createUserProfilesApiStub(expectedRecord) {
  const calls = [];

  return {
    calls,
    api: {
      resources: {
        userProfiles: {
          async query({ queryParams, format }) {
            assert.equal(format, "plain");
            calls.push(queryParams?.filters || {});
            return asCollectionDocument(
              expectedRecord ? [{
                ...expectedRecord,
                id: String(expectedRecord.id)
              }] : []
            );
          }
        }
      }
    }
  };
}

test("userSettingsRepository.ensureForUserId sends transaction outside plain data", async () => {
  const trx = { trxId: "trx-1" };
  let queryCount = 0;
  let postParams = null;
  const repository = createUserSettingsRepository({
    api: {
      resources: {
        userSettings: {
          async query() {
            queryCount += 1;
            return asCollectionDocument(
              queryCount < 2
                ? []
                : [{
                    id: "7",
                    ...DEFAULT_USER_SETTINGS
                  }]
            );
          },
          async post(params) {
            postParams = params;
            return {
              id: "7",
              ...DEFAULT_USER_SETTINGS
            };
          }
        }
      }
    }
  });

  const record = await repository.ensureForUserId("7", { trx });

  assert.equal(postParams?.format, "plain");
  assert.equal(postParams?.returning, "full");
  assert.equal(postParams?.transaction, trx);
  assert.deepEqual(postParams?.data, {
    id: "7",
    ...DEFAULT_USER_SETTINGS
  });
  assert.equal(record?.id, "7");
});

test("userProfilesRepository.upsert sends plain data with transaction outside the record body", async () => {
  const trx = { trxId: "trx-1" };
  let postParams = null;
  const repository = createUserProfilesRepository({
    api: {
      resources: {
        userProfiles: {
          vars: {},
          async query({ queryParams, format }) {
            assert.equal(format, "plain");
            const filters = queryParams?.filters || {};
            if (Object.hasOwn(filters, "authProvider") || Object.hasOwn(filters, "authProviderUserSid")) {
              return asCollectionDocument([]);
            }
            if (Object.hasOwn(filters, "usernames")) {
              return asCollectionDocument([]);
            }
            return asCollectionDocument([]);
          },
          async post(params) {
            postParams = params;
            const attributes = params.data || {};
            return {
              id: "11",
              authProvider: attributes.authProvider,
              authProviderUserSid: attributes.authProviderUserSid,
              email: attributes.email,
              username: attributes.username,
              displayName: attributes.displayName,
              avatarStorageKey: null,
              avatarVersion: null,
              avatarUpdatedAt: null,
              createdAt: attributes.createdAt
            };
          }
        }
      }
    }
  });

  const record = await repository.upsert({
    authProvider: "supabase",
    authProviderUserSid: "user-11",
    email: "ada@example.com",
    displayName: "Ada Example"
  }, { trx });

  assert.equal(postParams?.format, "plain");
  assert.equal(postParams?.returning, "full");
  assert.equal(postParams?.transaction, trx);
  assert.equal(postParams?.data?.transaction, undefined);
  assert.equal(postParams?.document, undefined);
  assert.equal(postParams?.inputRecord, undefined);
  assert.equal(postParams?.data?.authProvider, "supabase");
  assert.equal(record?.id, "11");
});

test("userProfilesRepository.upsert patches existing profiles with resource-backed updatedAt", async () => {
  const trx = { trxId: "trx-1" };
  const existingRecord = {
    id: "7",
    authProvider: "local",
    authProviderUserSid: "local-user-7",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Example",
    avatarStorageKey: null,
    avatarVersion: null,
    avatarUpdatedAt: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z"
  };
  let patchParams = null;
  const repository = createUserProfilesRepository({
    api: {
      resources: {
        userProfiles: {
          async query({ queryParams, format }) {
            assert.equal(format, "plain");
            const filters = queryParams?.filters || {};
            if (Object.hasOwn(filters, "authProvider") || Object.hasOwn(filters, "authProviderUserSid")) {
              return asCollectionDocument([existingRecord]);
            }
            if (Object.hasOwn(filters, "username")) {
              return asCollectionDocument([]);
            }
            return asCollectionDocument([]);
          },
          async patch(params) {
            patchParams = params;
            const attributes = params.data || {};
            return {
              ...existingRecord,
              ...attributes
            };
          }
        }
      }
    }
  });

  const record = await repository.upsert({
    authProvider: "local",
    authProviderUserSid: "local-user-7",
    email: " ADA.RENAMED@EXAMPLE.COM ",
    displayName: "Ada Renamed"
  }, { trx });

  const attributes = patchParams?.data || {};
  assert.equal(userProfileResource.schema.updatedAt?.type, "dateTime");
  assert.equal(userProfileResource.schema.updatedAt?.storage?.column, "updated_at");
  assert.equal(userProfileResource.schema.updatedAt?.storage?.writeSerializer, "datetime-utc");
  assert.equal(patchParams?.transaction, trx);
  assert.deepEqual(Object.keys(attributes).sort(), ["displayName", "email", "updatedAt", "username"]);
  assert.equal(attributes.email, "ada.renamed@example.com");
  assert.equal(attributes.displayName, "Ada Renamed");
  assert.equal(attributes.username, "ada");
  assert.equal(typeof attributes.updatedAt, "string");
  assert.equal(record?.id, "7");
  assert.equal(record?.updatedAt, attributes.updatedAt);
});

test("userProfilesRepository profile patch helpers stamp updatedAt through the resource contract", async () => {
  const trx = { trxId: "trx-1" };
  const calls = [];
  const repository = createUserProfilesRepository({
    api: {
      resources: {
        userProfiles: {
          async query() {
            return asCollectionDocument([]);
          },
          async patch(params) {
            calls.push(params);
            const attributes = params.data || {};
            return {
              id: params.id || "7",
              authProvider: "local",
              authProviderUserSid: "local-user-7",
              email: "ada@example.com",
              username: "ada",
              displayName: attributes.displayName || "Ada Example",
              avatarStorageKey: attributes.avatarStorageKey ?? null,
              avatarVersion: attributes.avatarVersion ?? null,
              avatarUpdatedAt: attributes.avatarUpdatedAt ?? null,
              createdAt: "2026-04-20T00:00:00.000Z",
              updatedAt: attributes.updatedAt
            };
          }
        }
      }
    }
  });
  const avatarUpdatedAt = new Date("2026-04-21T12:00:00.000Z");

  await repository.updateDisplayNameById("7", "Ada Updated", { trx });
  await repository.updateAvatarById("7", {
    avatarStorageKey: "avatars/7.png",
    avatarVersion: "v1",
    avatarUpdatedAt
  }, { trx });
  await repository.clearAvatarById("7", { trx });

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.transaction, trx);
    assert.equal(call.id, "7");
    assert.equal(call.format, "plain");
    assert.equal(call.returning, "full");
    assert.equal(call.document, undefined);
    assert.equal(call.inputRecord, undefined);
    assert.equal(typeof call.data?.updatedAt, "string");
  }
  assert.deepEqual(Object.keys(calls[0].data).sort(), ["displayName", "updatedAt"]);
  assert.deepEqual(Object.keys(calls[1].data).sort(), [
    "avatarStorageKey",
    "avatarUpdatedAt",
    "avatarVersion",
    "updatedAt"
  ]);
  assert.equal(calls[1].data.avatarStorageKey, "avatars/7.png");
  assert.equal(calls[1].data.avatarVersion, "v1");
  assert.equal(calls[1].data.avatarUpdatedAt, avatarUpdatedAt.toISOString());
  assert.deepEqual(calls[2].data.avatarStorageKey, null);
  assert.deepEqual(calls[2].data.avatarVersion, null);
  assert.deepEqual(calls[2].data.avatarUpdatedAt, null);
});

test("userProfilesRepository.findByEmail normalizes email lookup", async () => {
  const { api, calls } = createUserProfilesApiStub({
    id: 7,
    authProvider: "supabase",
    authProviderUserSid: "supabase-user-7",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Example",
    avatarStorageKey: null,
    avatarVersion: null,
    avatarUpdatedAt: null,
    createdAt: "2026-04-20T00:00:00.000Z"
  });
  const repository = createUserProfilesRepository({
    api
  });

  const profile = await repository.findByEmail(" ADA@EXAMPLE.COM ");

  assert.deepEqual(calls, [{ email: "ada@example.com" }]);
  assert.equal(profile?.id, "7");
  assert.equal(profile?.email, "ada@example.com");
  assert.equal(profile?.displayName, "Ada Example");
});

test("userProfilesRepository.findByIdentity reads existing profiles from collection documents", async () => {
  const { api, calls } = createUserProfilesApiStub({
    id: 7,
    authProvider: "supabase",
    authProviderUserSid: "supabase-user-7",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Example",
    avatarStorageKey: null,
    avatarVersion: null,
    avatarUpdatedAt: null,
    createdAt: "2026-04-20T00:00:00.000Z"
  });
  const repository = createUserProfilesRepository({
    api
  });

  const profile = await repository.findByIdentity({
    provider: "supabase",
    providerUserId: "supabase-user-7"
  });

  assert.deepEqual(calls, [{
    authProvider: "supabase",
    authProviderUserSid: "supabase-user-7"
  }]);
  assert.equal(profile?.id, "7");
  assert.equal(profile?.displayName, "Ada Example");
});

test("userProfilesRepository.findByEmail returns null when the row is missing", async () => {
  const { api } = createUserProfilesApiStub(undefined);
  const repository = createUserProfilesRepository({
    api
  });

  const profile = await repository.findByEmail("missing@example.com");

  assert.equal(profile, null);
});

for (const outcome of ["pending", "committed", "unknown"]) {
  test(`user settings preserves a ${outcome} write failure instead of recovering as a duplicate`, async () => {
    let reads = 0;
    const failure = Object.assign(new Error("Write failed"), {
      transactionOutcome: outcome,
      cause: { code: "23505" }
    });
    const api = {
      resources: {
        userSettings: {
          async query() { reads += 1; return asCollectionDocument([]); },
          async post() { throw failure; }
        }
      }
    };
    const repository = createUserSettingsRepository({ api });
    await assert.rejects(repository.ensureForUserId("7"), error => error === failure);
    assert.equal(reads, 1);
  });
}

test("user settings recovers a duplicate only after its standalone write rolled back", async () => {
  let reads = 0;
  const existing = { id: "7", ...DEFAULT_USER_SETTINGS };
  const api = {
    resources: {
      userSettings: {
        async query() { reads += 1; return asCollectionDocument(reads === 1 ? [] : [existing]); },
        async post() {
          throw Object.assign(new Error("Write failed"), {
            transactionOutcome: "rolledBack", cause: { code: "23505" }
          });
        }
      }
    }
  };
  const repository = createUserSettingsRepository({ api });
  assert.deepEqual(await repository.ensureForUserId("7"), existing);
  assert.equal(reads, 2);
});

test("profile upsert performs duplicate recovery after its API transaction has finished", async () => {
  const trx = { trxId: "managed-upsert" };
  const profile = {
    id: "7", authProvider: "local", authProviderUserSid: "local-7",
    email: "ada@example.com", username: "ada", displayName: "Ada"
  };
  let active = false;
  let rolledBack = false;
  const api = {
    async transaction(work) {
      active = true;
      try {
        return await work(trx);
      } catch (cause) {
        active = false;
        rolledBack = true;
        throw Object.assign(new Error("Transaction failed", { cause }), { transactionOutcome: "rolledBack" });
      }
    },
    resources: {
      userProfiles: {
        vars: {},
        async query({ transaction, queryParams, format }) {
          assert.equal(format, "plain");
          if (active) {
            assert.equal(transaction, trx);
            return asCollectionDocument([]);
          }
          assert.equal(rolledBack, true);
          assert.equal(transaction, null);
          assert.equal(queryParams.filters.authProviderUserSid, "local-7");
          return asCollectionDocument([profile]);
        },
        async post({ transaction }) {
          assert.equal(transaction, trx);
          throw Object.assign(new Error("Duplicate identity"), {
            transactionOutcome: "pending", cause: { code: "23505", message: "unique provider identity" }
          });
        }
      }
    }
  };
  const repository = createUserProfilesRepository({ api });
  assert.equal((await repository.upsert(profile)).id, "7");
  assert.equal(active, false);
});

test("profile upsert never recovers inside a caller-owned failed transaction", async () => {
  const trx = { trxId: "caller-managed" };
  let reads = 0;
  const failure = Object.assign(new Error("Duplicate identity"), {
    transactionOutcome: "pending", cause: { code: "23505" }
  });
  const api = {
    async transaction() { throw new Error("Must join the caller's owner"); },
    resources: {
      userProfiles: {
        vars: {},
        async query({ transaction }) {
          assert.equal(transaction, trx);
          reads += 1;
          return asCollectionDocument([]);
        },
        async post() { throw failure; }
      }
    }
  };
  const repository = createUserProfilesRepository({ api });
  await assert.rejects(repository.upsert({
    authProvider: "local", authProviderUserSid: "local-7",
    email: "ada@example.com", displayName: "Ada"
  }, { trx }), error => error === failure);
  assert.equal(reads, 2);
});

for (const outcome of ["pending", "committed", "unknown"]) {
  test(`profile email conflict preserves the ${outcome} outcome from a caller-owned write`, async () => {
    const trx = { trxId: "caller-managed" };
    let reads = 0;
    const failure = Object.assign(new Error("Resource write failed"), {
      transactionOutcome: outcome,
      cause: { code: "23505", message: "duplicate key in users_email_unique" }
    });
    const api = {
      resources: {
        userProfiles: {
          vars: {},
          async query() { reads += 1; return asCollectionDocument([]); },
          async post() { throw failure; }
        }
      }
    };
    const repository = createUserProfilesRepository({ api });
    await assert.rejects(repository.upsert({
      authProvider: "local", authProviderUserSid: "local-7",
      email: "ada@example.com", displayName: "Ada"
    }, { trx }), error => {
      if (outcome === "pending") {
        assert.equal(error.code, "USER_PROFILE_EMAIL_CONFLICT");
        assert.equal(error.cause, failure);
      } else {
        assert.equal(error, failure);
      }
      assert.equal(error.transactionOutcome, outcome);
      return true;
    });
    assert.equal(reads, 2);
  });
}

// The username upsert chooses for `email` while `holders` (username to profile id) are taken,
// and the username reads it made. `existing` is the identity's profile, when it has one.
async function chooseUsername(email, holders, { existing = null } = {}) {
  const trx = { trxId: "caller-managed" };
  const usernameReads = [];
  let written = null;
  const repository = createUserProfilesRepository({
    api: {
      resources: {
        userProfiles: {
          vars: {},
          async query({ queryParams, transaction }) {
            assert.equal(transaction, trx);
            const filters = queryParams?.filters || {};
            if (Object.hasOwn(filters, "usernames")) {
              usernameReads.push(filters.usernames);
              return asCollectionDocument(filters.usernames
                .filter((username) => holders.has(username))
                .map((username) => ({ id: holders.get(username), username })));
            }
            return asCollectionDocument(existing ? [existing] : []);
          },
          async post({ data }) {
            written = data.username;
            return { id: "11", ...data };
          },
          async patch({ id, data }) {
            written = data.username;
            return { ...existing, id, ...data };
          }
        }
      }
    }
  });
  await repository.upsert({
    authProvider: "local", authProviderUserSid: "local-7", email, displayName: "Ada"
  }, { trx });
  return { username: written, usernameReads };
}

const takenBy = (usernames, id = "8") => new Map(usernames.map((username) => [username, id]));

test("profile upsert chooses the first free username of base, base-2 to base-1000 in one read", async () => {
  const fresh = await chooseUsername("ada@example.com", new Map());
  assert.equal(fresh.username, "ada");
  assert.equal(fresh.usernameReads.length, 1);
  assert.equal(fresh.usernameReads[0].length, 1000);
  assert.deepEqual(fresh.usernameReads[0].slice(0, 3), ["ada", "ada-2", "ada-3"]);
  assert.equal(fresh.usernameReads[0][999], "ada-1000");

  assert.equal((await chooseUsername("ada@example.com", takenBy(["ada"]))).username, "ada-2");
  const gap = await chooseUsername("ada@example.com", takenBy(["ada", "ada-2", "ada-4", "ada-5"]));
  assert.equal(gap.username, "ada-3");
  assert.equal(gap.usernameReads.length, 1);
});

test("profile upsert trims a long username base so the suffixed name fits", async () => {
  const longBase = "a".repeat(120);
  const longEmail = `${"a".repeat(130)}@example.com`;
  assert.equal((await chooseUsername(longEmail, new Map())).username, longBase);
  assert.equal((await chooseUsername(longEmail, takenBy([longBase]))).username, `${"a".repeat(118)}-2`);
  const taken = [longBase, ...Array.from({ length: 8 }, (_, index) => `${"a".repeat(118)}-${index + 2}`)];
  assert.equal((await chooseUsername(longEmail, takenBy(taken))).username, `${"a".repeat(117)}-10`);
});

test("profile upsert keeps a username the profile itself holds", async () => {
  const existing = {
    id: "7", authProvider: "local", authProviderUserSid: "local-7",
    email: "ada@example.com", username: "", displayName: "Ada"
  };
  assert.equal((await chooseUsername("ada@example.com", takenBy(["ada"], "7"), { existing })).username, "ada");
  assert.equal((await chooseUsername("ada@example.com", takenBy(["ada"], "8"), { existing })).username, "ada-2");
});

test("profile upsert fails the same way when base to base-1000 are all taken", async () => {
  const taken = ["ada", ...Array.from({ length: 999 }, (_, index) => `ada-${index + 2}`)];
  await assert.rejects(chooseUsername("ada@example.com", takenBy(taken)), /Unable to generate unique username\./);
  assert.equal((await chooseUsername("ada@example.com", takenBy(taken.slice(0, -1)))).username, "ada-1000");
});
