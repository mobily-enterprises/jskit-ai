import assert from "node:assert/strict";
import test from "node:test";
import { __testables as calcTestables } from "../server/modules/history/repository.js";
import { __testables as profilesTestables } from "@jskit-ai/user-profile-core";
import { __testables as settingsTestables } from "../server/modules/settings/repository.js";

function createCalculationDbStub(options = {}) {
  const state = {
    inserted: null,
    whereArgs: [],
    orderByArgs: [],
    limitArgs: [],
    offsetArgs: [],
    countArgs: []
  };

  const rows = options.rows || [];
  const countRow = options.countRow || { total: 0 };

  function createChain() {
    return {
      async insert(payload) {
        state.inserted = payload;
      },
      where(condition) {
        state.whereArgs.push(condition);
        return this;
      },
      count(payload) {
        state.countArgs.push(payload);
        return this;
      },
      first() {
        return Promise.resolve(countRow);
      },
      orderBy(column, direction) {
        state.orderByArgs.push([column, direction]);
        return this;
      },
      limit(value) {
        state.limitArgs.push(value);
        return this;
      },
      offset(value) {
        state.offsetArgs.push(value);
        return Promise.resolve(rows);
      }
    };
  }

  function dbClient() {
    return createChain();
  }

  return { dbClient, state };
}

test("calculation logs repository factory insert/count/list and mapper branches", async () => {
  const { dbClient, state } = createCalculationDbStub({
    rows: [
      {
        id: "entry-1",
        created_at: "2024-01-01T00:00:00.000Z",
        deg2rad_operation: "DEG2RAD",
        deg2rad_formula: "DEG2RAD(x) = x * PI / 180",
        deg2rad_degrees: "180.000000000000",
        deg2rad_radians: "3.141592653590"
      }
    ],
    countRow: { total: "3" }
  });
  const repo = calcTestables.createCalculationLogsRepository(dbClient);
  const workspaceId = 8;
  const userId = 5;

  await repo.insert(workspaceId, userId, {
    id: "entry-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    DEG2RAD_operation: "DEG2RAD",
    DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
    DEG2RAD_degrees: "180.000000000000",
    DEG2RAD_radians: "3.141592653590"
  });

  assert.equal(state.inserted.workspace_id, workspaceId);
  assert.equal(state.inserted.user_id, userId);
  assert.equal(state.inserted.id, "entry-1");
  assert.equal(state.inserted.created_at, "2024-01-01 00:00:00.000");
  assert.equal(state.inserted.deg2rad_operation, "DEG2RAD");
  assert.equal(state.inserted.deg2rad_degrees, "180.000000000000");
  assert.equal(state.inserted.deg2rad_radians, "3.141592653590");

  const total = await repo.countForWorkspaceUser(workspaceId, userId);
  assert.equal(total, 3);

  const entries = await repo.listForWorkspaceUser(workspaceId, userId, 2, 10);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].DEG2RAD_operation, "DEG2RAD");
  assert.equal(entries[0].DEG2RAD_degrees, "180.000000000000");
  assert.equal(entries[0].DEG2RAD_radians, "3.141592653590");
  assert.equal(state.offsetArgs[0], 10);
  assert.deepEqual(state.whereArgs, [
    { workspace_id: workspaceId, user_id: userId },
    { workspace_id: workspaceId, user_id: userId }
  ]);

  assert.equal(calcTestables.normalizeCount({}), 0);
  assert.equal(calcTestables.normalizeCount(undefined), 0);
  assert.equal(calcTestables.normalizeCount({ total: "-1" }), 0);
  assert.equal(calcTestables.normalizeCount({ total: "2" }), 2);

  assert.throws(() => calcTestables.mapCalculationRowRequired(null), /expected a row object/);

  const mappedRow = calcTestables.mapCalculationRowRequired({
    id: "entry-2",
    created_at: "2024-01-01T00:00:00.000Z",
    deg2rad_degrees: "90.000000",
    deg2rad_radians: "1.570796326795"
  });
  assert.equal(mappedRow.DEG2RAD_operation, "DEG2RAD");
  assert.equal(mappedRow.DEG2RAD_degrees, "90.000000");
  assert.equal(mappedRow.DEG2RAD_radians, "1.570796326795");
});

function duplicateErrorFor(fieldName) {
  const error = new Error(`Duplicate entry for ${fieldName}`);
  error.code = "ER_DUP_ENTRY";
  error.sqlMessage = `Duplicate entry 'x' for key '${fieldName}'`;
  return error;
}

function createProfilesDbStub({ transactionImpl }) {
  function dbClient() {
    throw new Error("Direct table calls are not expected in this test stub.");
  }

  dbClient.transaction = transactionImpl;
  return dbClient;
}

test("user profiles helpers and mapper branches", () => {
  assert.equal(profilesTestables.isDuplicateEntryError(null), false);
  assert.equal(profilesTestables.isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(profilesTestables.duplicateEntryTargetsField(duplicateErrorFor("email"), "email"), true);
  assert.equal(profilesTestables.duplicateEntryTargetsField(duplicateErrorFor("auth_provider_user_id"), "email"), false);
  assert.equal(
    profilesTestables.duplicateEntryTargetsField(
      Object.assign(new Error("duplicate entry for key email"), { code: "ER_DUP_ENTRY" }),
      "email"
    ),
    true
  );
  assert.equal(profilesTestables.duplicateEntryTargetsField({ code: "ER_DUP_ENTRY" }, "email"), false);
  assert.equal(profilesTestables.duplicateEntryTargetsField(duplicateErrorFor("email"), ""), true);
  assert.equal(profilesTestables.isMysqlDuplicateEmailError(duplicateErrorFor("email")), true);
  assert.equal(profilesTestables.isMysqlDuplicateAuthProviderIdentityError(duplicateErrorFor("auth_provider_user_id")), true);
  assert.equal(profilesTestables.createDuplicateEmailConflictError().code, "USER_PROFILE_EMAIL_CONFLICT");

  assert.equal(profilesTestables.mapProfileRowNullable(null), null);
  assert.throws(() => profilesTestables.mapProfileRowRequired(null), /expected a row object/);
});

test("user profiles repository upsert handles insert, update, duplicate-email, and race cases", async () => {
  const records = [];

  const repo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            undefined,
            {
              id: 9,
              auth_provider: "supabase",
              auth_provider_user_id: "user-1",
              email: "first@example.com",
              display_name: "first",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = (table) => ({
          where(whereCondition) {
            records.push(["where", table, whereCondition]);
            return this;
          },
          async first() {
            return sequence.firstResponses.shift();
          },
          async update(payload) {
            records.push(["update", table, payload]);
          },
          async insert(payload) {
            records.push(["insert", table, payload]);
          }
        });
        return callback(trx);
      }
    })
  );

  const inserted = await repo.upsert({
    authProvider: "supabase",
    authProviderUserId: "user-1",
    email: "first@example.com",
    displayName: "first"
  });
  assert.equal(inserted.authProviderUserId, "user-1");
  assert.ok(records.some((entry) => entry[0] === "insert"));

  const updatedRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            {
              id: 4,
              auth_provider: "supabase",
              auth_provider_user_id: "user-2",
              email: "old@example.com",
              display_name: "old",
              created_at: "2024-01-01T00:00:00.000Z"
            },
            {
              id: 4,
              auth_provider: "supabase",
              auth_provider_user_id: "user-2",
              email: "new@example.com",
              display_name: "new",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift());
          },
          update(payload) {
            assert.equal(payload.email, "new@example.com");
            return Promise.resolve();
          },
          insert() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  const updated = await updatedRepo.upsert({
    authProvider: "supabase",
    authProviderUserId: "user-2",
    email: "new@example.com",
    displayName: "new"
  });
  assert.equal(updated.email, "new@example.com");

  const duplicateEmailRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(undefined);
          },
          insert() {
            return Promise.reject(duplicateErrorFor("email"));
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      duplicateEmailRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u3",
        email: "dup@example.com",
        displayName: "dup"
      }),
    (error) => {
      assert.equal(error.code, "USER_PROFILE_EMAIL_CONFLICT");
      return true;
    }
  );

  const directFindCalls = [];
  const findDb = (table) => ({
    where(condition) {
      directFindCalls.push([table, condition]);
      return this;
    },
    async first() {
      return {
        id: 1,
        auth_provider: "supabase",
        auth_provider_user_id: "find-user",
        email: "find@example.com",
        display_name: "finder",
        created_at: "2024-01-01T00:00:00.000Z"
      };
    }
  });
  findDb.transaction = async () => {
    throw new Error("not used");
  };
  const findOnlyRepo = profilesTestables.createUserProfilesRepository(findDb);
  const found = await findOnlyRepo.findByIdentity({ provider: "supabase", providerUserId: "find-user" });
  assert.equal(found.email, "find@example.com");
  assert.equal(directFindCalls.length, 1);

  const duplicateRaceRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            undefined,
            {
              id: 11,
              auth_provider: "supabase",
              auth_provider_user_id: "u4",
              email: "existing@example.com",
              display_name: "existing",
              created_at: "2024-01-01T00:00:00.000Z"
            },
            {
              id: 11,
              auth_provider: "supabase",
              auth_provider_user_id: "u4",
              email: "existing@example.com",
              display_name: "existing",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift());
          },
          insert() {
            return Promise.reject(duplicateErrorFor("auth_provider_user_id"));
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  const raced = await duplicateRaceRepo.upsert({
    authProvider: "supabase",
    authProviderUserId: "u4",
    email: "existing@example.com",
    displayName: "existing"
  });
  assert.equal(raced.authProviderUserId, "u4");

  const raceMissingRowRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [undefined, undefined]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift());
          },
          insert() {
            return Promise.reject(duplicateErrorFor("auth_provider_user_id"));
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      raceMissingRowRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u5",
        email: "u5@example.com",
        displayName: "u5"
      }),
    /could not be reloaded/
  );

  const updateDuplicateEmailRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            undefined,
            {
              id: 12,
              auth_provider: "supabase",
              auth_provider_user_id: "u6",
              email: "old@example.com",
              display_name: "old",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift());
          },
          insert() {
            return Promise.reject(duplicateErrorFor("auth_provider_user_id"));
          },
          update() {
            return Promise.reject(duplicateErrorFor("email"));
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      updateDuplicateEmailRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u6",
        email: "dup@example.com",
        displayName: "dup"
      }),
    (error) => {
      assert.equal(error.code, "USER_PROFILE_EMAIL_CONFLICT");
      return true;
    }
  );

  const updateNonDuplicateErrorRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            undefined,
            {
              id: 13,
              auth_provider: "supabase",
              auth_provider_user_id: "u9",
              email: "u9@example.com",
              display_name: "u9",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift());
          },
          insert() {
            return Promise.reject(duplicateErrorFor("auth_provider_user_id"));
          },
          update() {
            return Promise.reject(new Error("failed raced update"));
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      updateNonDuplicateErrorRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u9",
        email: "u9@example.com",
        displayName: "u9"
      }),
    /failed raced update/
  );

  const nonDuplicateErrorRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(undefined);
          },
          insert() {
            return Promise.reject(new Error("db write failed"));
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      nonDuplicateErrorRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u7",
        email: "u7@example.com",
        displayName: "u7"
      }),
    /db write failed/
  );

  const finalReadDuplicateEmailRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [undefined]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            if (sequence.firstResponses.length > 0) {
              return Promise.resolve(sequence.firstResponses.shift());
            }
            return Promise.reject(duplicateErrorFor("email"));
          },
          insert() {
            return Promise.resolve();
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      finalReadDuplicateEmailRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u8",
        email: "u8@example.com",
        displayName: "u8"
      }),
    (error) => {
      assert.equal(error.code, "ER_DUP_ENTRY");
      return true;
    }
  );

  const finalReadNonDuplicateErrorRepo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [undefined]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            if (sequence.firstResponses.length > 0) {
              return Promise.resolve(sequence.firstResponses.shift());
            }
            return Promise.reject(new Error("final read failed"));
          },
          insert() {
            return Promise.resolve();
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  await assert.rejects(
    () =>
      finalReadNonDuplicateErrorRepo.upsert({
        authProvider: "supabase",
        authProviderUserId: "u10",
        email: "u10@example.com",
        displayName: "u10"
      }),
    /final read failed/
  );
});

test("user profiles repository supports provider-neutral identity upsert and lookup", async () => {
  const repo = profilesTestables.createUserProfilesRepository(
    createProfilesDbStub({
      transactionImpl: async (callback) => {
        const sequence = {
          firstResponses: [
            undefined,
            {
              id: 101,
              auth_provider: "clerk",
              auth_provider_user_id: "clerk-user-1",
              email: "clerk@example.com",
              display_name: "clerk-user",
              created_at: "2024-01-01T00:00:00.000Z"
            }
          ]
        };
        const trx = () => ({
          where() {
            return this;
          },
          first() {
            return Promise.resolve(sequence.firstResponses.shift() || null);
          },
          insert() {
            return Promise.resolve();
          },
          update() {
            return Promise.resolve();
          }
        });
        return callback(trx);
      }
    })
  );

  const upserted = await repo.upsert({
    authProvider: "clerk",
    authProviderUserId: "clerk-user-1",
    email: "clerk@example.com",
    displayName: "clerk-user"
  });
  assert.equal(upserted.authProvider, "clerk");
  assert.equal(upserted.authProviderUserId, "clerk-user-1");
  assert.equal("supabaseUserId" in upserted, false);

  const fallbackLookupDb = () => ({
    where() {
      return this;
    },
    async first() {
      return {
        id: 102,
        auth_provider: "supabase",
        auth_provider_user_id: "supabase-fallback-1",
        email: "fallback@example.com",
        display_name: "fallback-user",
        created_at: "2024-01-01T00:00:00.000Z"
      };
    }
  });
  fallbackLookupDb.transaction = async () => {
    throw new Error("not used");
  };

  const fallbackLookupRepo = profilesTestables.createUserProfilesRepository(fallbackLookupDb);
  const found = await fallbackLookupRepo.findByIdentity({
    provider: "supabase",
    providerUserId: "supabase-fallback-1"
  });
  assert.equal(found.authProvider, "supabase");
  assert.equal(found.authProviderUserId, "supabase-fallback-1");
  assert.equal("supabaseUserId" in found, false);
});

function createUserSettingsDbStub({ row, insertErrorOnce = null } = {}) {
  const state = {
    row: row || null,
    inserts: [],
    updates: [],
    whereArgs: []
  };
  let insertFailed = false;
  let whereCondition = {};

  function ensureRow(userId) {
    return {
      user_id: Number(userId),
      theme: "system",
      locale: "en-US",
      time_zone: "UTC",
      date_format: "system",
      number_format: "system",
      currency_code: "USD",
      notify_product_updates: 1,
      notify_account_activity: 1,
      notify_security_alerts: 1,
      default_mode: "fv",
      default_timing: "ordinary",
      default_payments_per_year: 12,
      default_history_page_size: 10,
      avatar_size: 64,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z"
    };
  }

  function chain() {
    return {
      where(condition) {
        whereCondition = condition;
        state.whereArgs.push(condition);
        return this;
      },
      async first() {
        if (!state.row) {
          return undefined;
        }
        if (whereCondition.user_id != null && Number(whereCondition.user_id) !== Number(state.row.user_id)) {
          return undefined;
        }
        return state.row;
      },
      async insert(payload) {
        state.inserts.push(payload);
        if (insertErrorOnce && !insertFailed) {
          insertFailed = true;
          state.row = ensureRow(payload.user_id);
          throw insertErrorOnce;
        }
        state.row = ensureRow(payload.user_id);
      },
      async update(payload) {
        state.updates.push(payload);
        state.row = {
          ...state.row,
          ...payload
        };
      }
    };
  }

  function dbClient() {
    return chain();
  }

  return { dbClient, state, ensureRow };
}

test("user settings repository helpers and CRUD branches", async () => {
  assert.equal(settingsTestables.isDuplicateEntryError(null), false);
  assert.equal(settingsTestables.isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(settingsTestables.isDuplicateEntryError({ code: "ER_PARSE_ERROR" }), false);
  assert.equal(settingsTestables.mapUserSettingsRowNullable(null), null);
  assert.throws(() => settingsTestables.mapUserSettingsRowRequired(null), /expected a row object/);

  const preferencesPatch = settingsTestables.buildPreferencesUpdatePatch({
    theme: "dark",
    locale: "en-GB",
    timeZone: "Europe/London",
    dateFormat: "dmy",
    numberFormat: "dot-comma",
    currencyCode: "EUR",
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 4,
    defaultHistoryPageSize: 25,
    avatarSize: 96
  });
  assert.equal(preferencesPatch.time_zone, "Europe/London");
  assert.equal(preferencesPatch.default_mode, "pv");
  assert.equal(preferencesPatch.avatar_size, 96);

  const notificationsPatch = settingsTestables.buildNotificationsUpdatePatch({
    productUpdates: false,
    accountActivity: true,
    securityAlerts: true
  });
  assert.equal(notificationsPatch.notify_product_updates, false);
  assert.equal(notificationsPatch.notify_security_alerts, true);

  const updatedPatch = settingsTestables.withUpdatedAt({ theme: "dark" }, new Date("2024-01-01T00:00:00.000Z"));
  assert.equal(updatedPatch.updated_at, "2024-01-01 00:00:00.000");

  const duplicateInsertError = duplicateErrorFor("PRIMARY");
  const { dbClient, state } = createUserSettingsDbStub({
    insertErrorOnce: duplicateInsertError
  });
  const repo = settingsTestables.createUserSettingsRepository(dbClient);

  state.row = {
    ...createUserSettingsDbStub().ensureRow(9),
    user_id: 9
  };
  const existing = await repo.findByUserId(9);
  assert.equal(existing.userId, 9);

  state.row = null;
  const ensured = await repo.ensureForUserId(10);
  assert.equal(ensured.userId, 10);
  assert.equal(state.inserts.length, 1);

  const preferencesUpdated = await repo.updatePreferences(10, {
    theme: "dark",
    defaultHistoryPageSize: 25
  });
  assert.equal(preferencesUpdated.theme, "dark");
  assert.equal(preferencesUpdated.defaultHistoryPageSize, 25);
  assert.equal(state.updates.length, 1);

  const unchangedPreferences = await repo.updatePreferences(10, {});
  assert.equal(unchangedPreferences.theme, "dark");
  assert.equal(state.updates.length, 1);

  const notificationsUpdated = await repo.updateNotifications(10, {
    productUpdates: false,
    accountActivity: false,
    securityAlerts: true
  });
  assert.equal(notificationsUpdated.productUpdates, false);
  assert.equal(notificationsUpdated.accountActivity, false);
  assert.equal(notificationsUpdated.securityAlerts, true);
  assert.equal(state.updates.length, 2);

  const unchangedNotifications = await repo.updateNotifications(10, {});
  assert.equal(unchangedNotifications.securityAlerts, true);
  assert.equal(state.updates.length, 2);

  const successInsertRepo = settingsTestables.createUserSettingsRepository(createUserSettingsDbStub().dbClient);
  const successInserted = await successInsertRepo.ensureForUserId(77);
  assert.equal(successInserted.userId, 77);

  const insertFailure = new Error("insert failed");
  const failingRepo = settingsTestables.createUserSettingsRepository(
    createUserSettingsDbStub({
      insertErrorOnce: insertFailure
    }).dbClient
  );
  await assert.rejects(() => failingRepo.ensureForUserId(99), /insert failed/);

  const syncThrowDb = () => ({
    where() {
      return this;
    },
    async first() {
      return undefined;
    },
    insert() {
      throw new Error("sync insert failure");
    },
    async update() {}
  });
  const syncThrowRepo = settingsTestables.createUserSettingsRepository(syncThrowDb);
  await assert.rejects(() => syncThrowRepo.ensureForUserId(55), /sync insert failure/);
});

test("user profiles repository updateDisplayNameById maps updated row", async () => {
  const calls = [];
  const dbClient = () => ({
    where(condition) {
      calls.push(["where", condition]);
      return this;
    },
    async update(payload) {
      calls.push(["update", payload]);
    },
    async first() {
      return {
        id: 12,
        auth_provider: "supabase",
        auth_provider_user_id: "supabase-12",
        email: "user12@example.com",
        display_name: "new-name",
        created_at: "2024-01-01T00:00:00.000Z"
      };
    }
  });
  dbClient.transaction = async () => {
    throw new Error("not used");
  };

  const repo = profilesTestables.createUserProfilesRepository(dbClient);
  const updated = await repo.updateDisplayNameById(12, "new-name");

  assert.equal(updated.id, 12);
  assert.equal(updated.displayName, "new-name");
  assert.ok(calls.some((entry) => entry[0] === "update"));
});

test("user profiles repository avatar update and clear methods map avatar fields", async () => {
  const responses = [
    {
      id: 15,
      auth_provider: "supabase",
      auth_provider_user_id: "supabase-15",
      email: "user15@example.com",
      display_name: "user15",
      avatar_storage_key: "avatars/users/15/avatar.webp",
      avatar_version: "123",
      avatar_updated_at: "2024-01-02T00:00:00.000Z",
      created_at: "2024-01-01T00:00:00.000Z"
    },
    {
      id: 15,
      auth_provider: "supabase",
      auth_provider_user_id: "supabase-15",
      email: "user15@example.com",
      display_name: "user15",
      avatar_storage_key: null,
      avatar_version: null,
      avatar_updated_at: null,
      created_at: "2024-01-01T00:00:00.000Z"
    }
  ];
  const updates = [];

  const dbClient = () => ({
    where() {
      return this;
    },
    async update(payload) {
      updates.push(payload);
    },
    async first() {
      return responses.shift();
    }
  });
  dbClient.transaction = async () => {
    throw new Error("not used");
  };

  const repo = profilesTestables.createUserProfilesRepository(dbClient);
  const uploaded = await repo.updateAvatarById(15, {
    avatarStorageKey: "avatars/users/15/avatar.webp",
    avatarVersion: "123",
    avatarUpdatedAt: new Date("2024-01-02T00:00:00.000Z")
  });
  assert.equal(uploaded.avatarStorageKey, "avatars/users/15/avatar.webp");
  assert.equal(uploaded.avatarVersion, "123");

  const cleared = await repo.clearAvatarById(15);
  assert.equal(cleared.avatarStorageKey, null);
  assert.equal(cleared.avatarVersion, null);
  assert.equal(cleared.avatarUpdatedAt, null);
  assert.equal(updates.length, 2);
});
