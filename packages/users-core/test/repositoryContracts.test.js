import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS } from "../src/shared/settings.js";
import { createRepository as createUserProfilesRepository } from "../src/server/common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";

function createKnexStub() {
  const knex = Object.assign(() => {
    throw new Error("query execution not expected");
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return knex;
}

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
}

test("users-core repositories expose withTransaction", async () => {
  const knex = createKnexStub();
  const api = {
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
    createUserProfilesRepository({ api, knex }),
    createUserSettingsRepository({ api, knex })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});

function createUserProfilesApiStub(expectedRecord) {
  const calls = [];

  return {
    calls,
    api: {
      resources: {
        userProfiles: {
          async query({ queryParams }) {
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

test("userSettingsRepository.ensureForUserId sends transaction outside simplified attributes", async () => {
  const trx = { trxId: "trx-1" };
  let queryCount = 0;
  let postParams = null;
  const repository = createUserSettingsRepository({
    knex: createKnexStub(),
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

  assert.equal(postParams?.simplified, undefined);
  assert.equal(postParams?.transaction, trx);
  assert.deepEqual(postParams?.inputRecord?.data, {
    type: "userSettings",
    id: "7",
    attributes: {
      id: "7",
      ...DEFAULT_USER_SETTINGS
    }
  });
  assert.equal(record?.id, "7");
});

test("userProfilesRepository.upsert sends native JSON:API write documents with transaction outside the record body", async () => {
  const trx = { trxId: "trx-1" };
  let postParams = null;
  const repository = createUserProfilesRepository({
    knex: createKnexStub(),
    api: {
      resources: {
        userProfiles: {
          async query({ queryParams }) {
            const filters = queryParams?.filters || {};
            if (Object.hasOwn(filters, "authProvider") || Object.hasOwn(filters, "authProviderUserSid")) {
              return asCollectionDocument([]);
            }
            if (Object.hasOwn(filters, "username")) {
              return asCollectionDocument([]);
            }
            return asCollectionDocument([]);
          },
          async post(params) {
            postParams = params;
            const attributes = params.inputRecord?.data?.attributes || {};
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

  assert.equal(postParams?.simplified, undefined);
  assert.equal(postParams?.transaction, trx);
  assert.equal(postParams?.inputRecord?.transaction, undefined);
  assert.equal(postParams?.inputRecord?.data?.type, "userProfiles");
  assert.equal(postParams?.inputRecord?.data?.attributes?.authProvider, "supabase");
  assert.equal(record?.id, "11");
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
    api,
    knex: createKnexStub()
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
    api,
    knex: createKnexStub()
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
    api,
    knex: createKnexStub()
  });

  const profile = await repository.findByEmail("missing@example.com");

  assert.equal(profile, null);
});
