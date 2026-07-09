import { isDuplicateEntryError } from "@jskit-ai/database-runtime/shared/duplicateEntry";

const TABLES = Object.freeze({
  users: "auth_local_users",
  sessions: "auth_local_sessions",
  recovery: "auth_local_recovery"
});

function nowIso() {
  return new Date().toISOString();
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid local auth DB timestamp.");
  }
  return date;
}

function requiredDateTime(value, fallback = nowIso()) {
  return toDate(value || fallback);
}

function optionalDateTime(value) {
  return value ? toDate(value) : null;
}

function readDateTime(value, fallback = "") {
  if (!value) {
    return fallback;
  }
  return toDate(value).toISOString();
}

function readPassword(row) {
  return {
    algorithm: String(row.password_algorithm || ""),
    version: String(row.password_version || ""),
    salt: String(row.password_salt || ""),
    hash: String(row.password_hash || "")
  };
}

function writePassword(password = {}) {
  return {
    password_algorithm: String(password.algorithm || ""),
    password_version: String(password.version || ""),
    password_salt: String(password.salt || ""),
    password_hash: String(password.hash || "")
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || ""),
    email: String(row.email || ""),
    displayName: String(row.display_name || ""),
    password: readPassword(row),
    createdAt: readDateTime(row.created_at),
    updatedAt: readDateTime(row.updated_at),
    disabled: row.disabled === true || row.disabled === 1 || row.disabled === "1"
  };
}

function mapSession(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || ""),
    tokenHash: String(row.token_hash || ""),
    purpose: String(row.purpose || "normal"),
    createdAt: readDateTime(row.created_at),
    expiresAt: readDateTime(row.expires_at),
    revokedAt: readDateTime(row.revoked_at)
  };
}

function mapRecovery(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || ""),
    tokenHash: String(row.token_hash || ""),
    createdAt: readDateTime(row.created_at),
    expiresAt: readDateTime(row.expires_at),
    usedAt: readDateTime(row.used_at)
  };
}

function userInsert(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: String(input.id || ""),
    email: String(input.email || ""),
    display_name: String(input.displayName || ""),
    ...writePassword(input.password),
    disabled: input.disabled === true,
    created_at: createdAt,
    updated_at: requiredDateTime(input.updatedAt, createdAt)
  };
}

function sessionInsert(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: String(input.id || ""),
    user_id: String(input.userId || ""),
    token_hash: String(input.tokenHash || ""),
    purpose: String(input.purpose || "normal"),
    expires_at: requiredDateTime(input.expiresAt),
    revoked_at: optionalDateTime(input.revokedAt),
    created_at: createdAt,
    updated_at: requiredDateTime(input.updatedAt, createdAt)
  };
}

function recoveryInsert(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: String(input.id || ""),
    user_id: String(input.userId || ""),
    token_hash: String(input.tokenHash || ""),
    expires_at: requiredDateTime(input.expiresAt),
    used_at: optionalDateTime(input.usedAt),
    created_at: createdAt,
    updated_at: requiredDateTime(input.updatedAt, createdAt)
  };
}

function assertBackendDependencies({ knex, transactionManager } = {}) {
  if (typeof knex !== "function") {
    throw new Error("createLocalDbBackend requires jskit.database.knex.");
  }
  if (!transactionManager || typeof transactionManager.inTransaction !== "function") {
    throw new Error("createLocalDbBackend requires jskit.database.transactionManager.");
  }
}

function createLocalDbBackend({ knex, transactionManager } = {}) {
  assertBackendDependencies({ knex, transactionManager });

  function table(client, tableName) {
    return client(tableName);
  }

  function createTx(client) {
    return Object.freeze({
      users: Object.freeze({
        async create(input) {
          const row = userInsert(input);
          try {
            await table(client, TABLES.users).insert(row);
          } catch (error) {
            if (isDuplicateEntryError(error, { client: knex })) {
              throw new Error("Local auth user already exists.");
            }
            throw error;
          }
          return mapUser(row);
        },
        async findById(userId) {
          return mapUser(await table(client, TABLES.users).where({ id: String(userId || "") }).first());
        },
        async findByEmail(email) {
          return mapUser(await table(client, TABLES.users).where({ email: String(email || "") }).first());
        },
        async updatePassword(userId, passwordRecord) {
          const updatedAt = requiredDateTime();
          await table(client, TABLES.users)
            .where({ id: String(userId || "") })
            .update({
              ...writePassword(passwordRecord),
              updated_at: updatedAt
            });
          return mapUser(await table(client, TABLES.users).where({ id: String(userId || "") }).first());
        },
        async updateProfile(userId, updates = {}) {
          const patch = {
            updated_at: requiredDateTime()
          };
          if (typeof updates.displayName === "string") {
            patch.display_name = updates.displayName;
          }
          await table(client, TABLES.users).where({ id: String(userId || "") }).update(patch);
          return mapUser(await table(client, TABLES.users).where({ id: String(userId || "") }).first());
        }
      }),
      sessions: Object.freeze({
        async create(input) {
          const row = sessionInsert(input);
          await table(client, TABLES.sessions).insert(row);
          return mapSession(row);
        },
        async findById(sessionId) {
          return mapSession(await table(client, TABLES.sessions).where({ id: String(sessionId || "") }).first());
        },
        async findByTokenHash(tokenHash) {
          return mapSession(await table(client, TABLES.sessions).where({ token_hash: String(tokenHash || "") }).first());
        },
        async revoke(sessionId) {
          const existing = await table(client, TABLES.sessions).where({ id: String(sessionId || "") }).first();
          if (!existing || existing.revoked_at) {
            return mapSession(existing);
          }
          const updatedAt = requiredDateTime();
          await table(client, TABLES.sessions)
            .where({ id: String(sessionId || "") })
            .update({
              revoked_at: updatedAt,
              updated_at: updatedAt
            });
          return mapSession(await table(client, TABLES.sessions).where({ id: String(sessionId || "") }).first());
        },
        async revokeForUser(userId, options = {}) {
          const query = table(client, TABLES.sessions)
            .where({ user_id: String(userId || "") })
            .whereNull("revoked_at");
          const exceptSessionId = String(options.exceptSessionId || "");
          if (exceptSessionId) {
            query.whereNot("id", exceptSessionId);
          }
          const updatedAt = requiredDateTime();
          const count = await query.update({
            revoked_at: updatedAt,
            updated_at: updatedAt
          });
          return Number(count || 0);
        }
      }),
      recovery: Object.freeze({
        async create(input) {
          const row = recoveryInsert(input);
          await table(client, TABLES.recovery).insert(row);
          return mapRecovery(row);
        },
        async findByTokenHash(tokenHash) {
          return mapRecovery(await table(client, TABLES.recovery).where({ token_hash: String(tokenHash || "") }).first());
        },
        async consume(tokenId) {
          const existing = await table(client, TABLES.recovery).where({ id: String(tokenId || "") }).first();
          if (!existing || existing.used_at) {
            return mapRecovery(existing);
          }
          const updatedAt = requiredDateTime();
          await table(client, TABLES.recovery)
            .where({ id: String(tokenId || "") })
            .update({
              used_at: updatedAt,
              updated_at: updatedAt
            });
          return mapRecovery(await table(client, TABLES.recovery).where({ id: String(tokenId || "") }).first());
        },
        async consumeForUser(userId) {
          const updatedAt = requiredDateTime();
          const count = await table(client, TABLES.recovery)
            .where({ user_id: String(userId || "") })
            .whereNull("used_at")
            .update({
              used_at: updatedAt,
              updated_at: updatedAt
            });
          return Number(count || 0);
        }
      })
    });
  }

  return Object.freeze({
    tables: TABLES,
    async withTransaction(callback) {
      return transactionManager.inTransaction(async (trx) => callback(createTx(trx)));
    }
  });
}

export { TABLES as LOCAL_AUTH_DB_TABLES, createLocalDbBackend };
