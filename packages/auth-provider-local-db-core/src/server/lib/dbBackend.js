import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { isDuplicateEntryError } from "@jskit-ai/database-runtime/shared/duplicateEntry";
import { nowIso, toDate } from "./dateTimes.js";
import { IDENTITIES_TABLE } from "./identityStore.js";

const TABLES = Object.freeze({
  users: "auth_local_users",
  sessions: "auth_local_sessions",
  recovery: "auth_local_recovery",
  identities: IDENTITIES_TABLE,
  oauthAttempts: "auth_local_oauth_attempts",
  signInFailures: "auth_local_sign_in_failures",
  registrations: "auth_local_registrations"
});

// The tables local sign-in keeps outside table resources, for an app test's expectEveryTableOwned infrastructureTables.
const INFRASTRUCTURE_TABLES = Object.freeze([IDENTITIES_TABLE]);

// One page of one record: a lookup by a unique field.
const FIRST = Object.freeze({ size: 1 });

// The ISO text written for a required timestamp: the value, or the fallback (now) when it has none.
function requiredDateTime(value, fallback = nowIso()) {
  return toDate(value || fallback).toISOString();
}

function optionalDateTime(value) {
  return value ? toDate(value).toISOString() : null;
}

function readDateTime(value, fallback = "") {
  if (!value) {
    return fallback;
  }
  return toDate(value).toISOString();
}

function text(value) {
  return String(value || "");
}

function readPassword(record) {
  return {
    algorithm: text(record.passwordAlgorithm),
    version: text(record.passwordVersion),
    salt: text(record.passwordSalt),
    hash: text(record.passwordHash)
  };
}

function writePassword(password = {}) {
  return {
    passwordAlgorithm: text(password.algorithm),
    passwordVersion: text(password.version),
    passwordSalt: text(password.salt),
    passwordHash: text(password.hash)
  };
}

function mapUser(record) {
  if (!record) {
    return null;
  }
  return {
    id: text(record.id),
    email: text(record.email),
    displayName: text(record.displayName),
    password: readPassword(record),
    createdAt: readDateTime(record.createdAt),
    updatedAt: readDateTime(record.updatedAt),
    emailVerifiedAt: readDateTime(record.emailVerifiedAt),
    disabled: record.disabled === true || record.disabled === 1 || record.disabled === "1"
  };
}

function mapSession(record) {
  if (!record) {
    return null;
  }
  return {
    id: text(record.id),
    userId: text(record.userId),
    tokenHash: text(record.tokenHash),
    purpose: String(record.purpose || "normal"),
    createdAt: readDateTime(record.createdAt),
    expiresAt: readDateTime(record.expiresAt),
    revokedAt: readDateTime(record.revokedAt)
  };
}

function mapRecovery(record) {
  if (!record) {
    return null;
  }
  return {
    id: text(record.id),
    userId: text(record.userId),
    tokenHash: text(record.tokenHash),
    createdAt: readDateTime(record.createdAt),
    expiresAt: readDateTime(record.expiresAt),
    usedAt: readDateTime(record.usedAt)
  };
}

function mapOAuthAttempt(record) {
  if (!record) {
    return null;
  }
  return {
    browserKeyHash: text(record.id),
    provider: text(record.provider),
    intent: text(record.intent),
    userId: text(record.userId),
    state: text(record.state),
    nonce: text(record.nonce),
    codeVerifier: text(record.codeVerifier),
    returnTo: text(record.returnTo),
    createdAt: readDateTime(record.createdAt),
    expiresAt: readDateTime(record.expiresAt)
  };
}

function mapSignInFailures(record) {
  if (!record) {
    return null;
  }
  return {
    email: text(record.id),
    failures: Number(record.failures || 0),
    lastFailedAt: readDateTime(record.lastFailedAt),
    lockedUntil: readDateTime(record.lockedUntil)
  };
}

function mapRegistration(record) {
  if (!record) {
    return null;
  }
  const invitationToken = text(record.invitationToken);
  return {
    email: text(record.id),
    displayName: text(record.displayName),
    password: readPassword(record),
    invitation: invitationToken ? { token: invitationToken, source: text(record.invitationSource) } : null,
    tokenHash: text(record.tokenHash),
    createdAt: readDateTime(record.createdAt),
    expiresAt: readDateTime(record.expiresAt)
  };
}

function registrationRecord(input = {}) {
  return {
    displayName: text(input.displayName),
    ...writePassword(input.password),
    invitationToken: input.invitation?.token ? String(input.invitation.token) : null,
    invitationSource: input.invitation?.token ? text(input.invitation.source) : null,
    tokenHash: text(input.tokenHash),
    createdAt: requiredDateTime(input.createdAt),
    expiresAt: requiredDateTime(input.expiresAt)
  };
}

function userRecord(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: text(input.id),
    email: text(input.email),
    displayName: text(input.displayName),
    ...writePassword(input.password),
    disabled: input.disabled === true,
    createdAt,
    updatedAt: requiredDateTime(input.updatedAt, createdAt)
  };
}

function sessionRecord(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: text(input.id),
    userId: text(input.userId),
    tokenHash: text(input.tokenHash),
    purpose: String(input.purpose || "normal"),
    expiresAt: requiredDateTime(input.expiresAt),
    revokedAt: optionalDateTime(input.revokedAt),
    createdAt,
    updatedAt: requiredDateTime(input.updatedAt, createdAt)
  };
}

function recoveryRecord(input = {}) {
  const createdAt = requiredDateTime(input.createdAt);
  return {
    id: text(input.id),
    userId: text(input.userId),
    tokenHash: text(input.tokenHash),
    expiresAt: requiredDateTime(input.expiresAt),
    usedAt: optionalDateTime(input.usedAt),
    createdAt,
    updatedAt: requiredDateTime(input.updatedAt, createdAt)
  };
}

function oauthAttemptRecord(input = {}) {
  return {
    id: text(input.browserKeyHash),
    provider: text(input.provider),
    intent: text(input.intent),
    userId: input.userId ? String(input.userId) : null,
    state: text(input.state),
    nonce: text(input.nonce),
    codeVerifier: text(input.codeVerifier),
    returnTo: text(input.returnTo),
    expiresAt: requiredDateTime(input.expiresAt),
    createdAt: requiredDateTime(input.createdAt)
  };
}

/**
 * The record a unique field's value finds, or null; an empty value finds none.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {string} field
 * @param {unknown} value
 * @param {object} options
 */
async function findOne(handle, field, value, options) {
  const wanted = text(value);
  if (!wanted) {
    return null;
  }
  const { records } = await handle.query({ filters: { [field]: wanted }, page: FIRST }, options);
  return records[0] || null;
}

/**
 * The record with this id, or null; an empty id finds none.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {object} options
 */
async function findById(handle, id, options) {
  const wanted = text(id);
  return wanted ? handle.get(wanted, {}, { ...options, missing: "skip" }) : null;
}

/**
 * Deletes the record with this id and answers 1, or 0 when it is missing: one DELETE, so of two concurrent deletes
 * only one answers 1.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {object} options
 */
async function deleteById(handle, id, options) {
  const wanted = text(id);
  return wanted && (await handle.delete(wanted, { ...options, missing: "skip" })) !== null ? 1 : 0;
}

/**
 * Writes an email's sign-in failure record: patches it when it exists, creates it otherwise. An upsert keyed on the
 * email would keep the later of two first failures counted at once, so they would count once; this create instead
 * fails the later one with a duplicate entry, and the backend runs that sign-in again on the row the first one made.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} failures
 * @param {string} email
 * @param {Record<string, unknown>} attributes
 * @param {object} options
 */
async function replaceFailures(failures, email, attributes, options) {
  if (await failures.get(email, {}, { ...options, missing: "skip" })) {
    await failures.patch(email, attributes, { ...options, returning: "none" });
  } else {
    await failures.create({ id: email, ...attributes }, { ...options, returning: "none" });
  }
}

/**
 * Patches an existing record and answers it after the change; null when it is missing, which fails no transaction.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {Record<string, unknown>} changes
 * @param {object} options
 */
async function patchExisting(handle, id, changes, options) {
  const wanted = text(id);
  return wanted ? handle.patch(wanted, changes, { ...options, missing: "skip" }) : null;
}

/**
 * Local auth's accounts.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} users
 * @param {object} options
 */
function userRecords(users, options) {
  return Object.freeze({
    async create(input) {
      const record = userRecord(input);
      try {
        await users.create(record, { ...options, returning: "none" });
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          throw new Error("Local auth user already exists.");
        }
        throw error;
      }
      return mapUser(record);
    },
    async findById(userId) {
      return mapUser(await findById(users, userId, options));
    },
    async findByEmail(email) {
      return mapUser(await findOne(users, "email", email, options));
    },
    async hasAny() {
      return (await users.query({ page: FIRST }, options)).records.length > 0;
    },
    async updatePassword(userId, passwordRecord) {
      return mapUser(await patchExisting(users, userId, { ...writePassword(passwordRecord), updatedAt: requiredDateTime() }, options));
    },
    async updateProfile(userId, updates = {}) {
      const changes = { updatedAt: requiredDateTime() };
      if (typeof updates.displayName === "string") {
        changes.displayName = updates.displayName;
      }
      return mapUser(await patchExisting(users, userId, changes, options));
    },
    // Using an emailed link proves the account owns its email address; the first proof is kept.
    async markEmailVerified(userId) {
      const id = text(userId);
      if (!id) {
        return null;
      }
      await users.patch(id, { emailVerifiedAt: requiredDateTime() }, { ...options, onlyIf: { emailVerifiedAt: null }, missing: "skip", returning: "none" });
      return mapUser(await users.get(id, {}, { ...options, missing: "skip" }));
    }
  });
}

/**
 * Local auth's sessions.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} sessions
 * @param {object} options
 */
function sessionRecords(sessions, options) {
  return Object.freeze({
    async create(input) {
      const record = sessionRecord(input);
      await sessions.create(record, { ...options, returning: "none" });
      return mapSession(record);
    },
    async findById(sessionId) {
      return mapSession(await findById(sessions, sessionId, options));
    },
    async findByTokenHash(tokenHash) {
      return mapSession(await findOne(sessions, "tokenHash", tokenHash, options));
    },
    // Only a session's purpose and expiry change, as when a magic-link session becomes a normal one.
    async update(sessionId, { purpose, expiresAt, ...rest } = {}) {
      if (Object.keys(rest).length > 0) {
        throw new TypeError("auth.local.sessions.update() changes a session's purpose and expiresAt only.");
      }
      const changes = { updatedAt: requiredDateTime() };
      if (purpose !== undefined) {
        changes.purpose = String(purpose || "normal");
      }
      if (expiresAt !== undefined) {
        changes.expiresAt = requiredDateTime(expiresAt);
      }
      return mapSession(await patchExisting(sessions, sessionId, changes, options));
    },
    async revoke(sessionId) {
      const existing = await findById(sessions, sessionId, options);
      if (!existing || existing.revokedAt) {
        return mapSession(existing);
      }
      const revokedAt = requiredDateTime();
      return mapSession(await sessions.patch(existing.id, { revokedAt, updatedAt: revokedAt }, { ...options, missing: "skip" }));
    },
    // revokeOptions.exceptSessionId keeps that session.
    async revokeForUser(userId, revokeOptions = {}) {
      const owner = text(userId);
      if (!owner) {
        return 0;
      }
      const exceptSessionId = text(revokeOptions.exceptSessionId);
      const revokedAt = requiredDateTime();
      return sessions.patchWhere(
        exceptSessionId ? { userId: owner, exceptId: exceptSessionId } : { userId: owner },
        { revokedAt, updatedAt: revokedAt },
        { ...options, onlyIf: { revokedAt: null }, returning: "count" }
      );
    },
    async deleteExpired(now) {
      return sessions.deleteWhere({ expiresAtOrBefore: requiredDateTime(now) }, { ...options, returning: "count" });
    }
  });
}

/**
 * Local auth's password recovery tokens.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} recovery
 * @param {object} options
 */
function recoveryRecords(recovery, options) {
  return Object.freeze({
    async create(input) {
      const record = recoveryRecord(input);
      await recovery.create(record, { ...options, returning: "none" });
      return mapRecovery(record);
    },
    async findByTokenHash(tokenHash) {
      return mapRecovery(await findOne(recovery, "tokenHash", tokenHash, options));
    },
    // The consumed token, or null when it is missing or already used: of two consumers at once, the one whose
    // conditional write lands first wins.
    async consume(tokenId) {
      const id = text(tokenId);
      if (!id) {
        return null;
      }
      const usedAt = requiredDateTime();
      return mapRecovery(await recovery.patch(id, { usedAt, updatedAt: usedAt }, {
        ...options,
        onlyIf: { usedAt: null },
        missing: "skip"
      }));
    },
    async consumeForUser(userId) {
      const owner = text(userId);
      if (!owner) {
        return 0;
      }
      const usedAt = requiredDateTime();
      return recovery.patchWhere({ userId: owner }, { usedAt, updatedAt: usedAt }, {
        ...options,
        onlyIf: { usedAt: null },
        returning: "count"
      });
    }
  });
}

/**
 * Local auth's pending provider sign-ins and links.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} attempts
 * @param {object} options
 */
function oauthAttemptRecords(attempts, options) {
  return Object.freeze({
    async create(input) {
      const record = oauthAttemptRecord(input);
      await attempts.create(record, { ...options, returning: "none" });
      return mapOAuthAttempt(record);
    },
    // Only the request that locks the row and deletes it gets the attempt, so concurrent callbacks on several servers
    // cannot both use it: the others wait for the lock and then find no row. It runs in the backend's transaction.
    async take(browserKeyHash) {
      const id = text(browserKeyHash);
      const [record] = id ? await attempts.lockMany([id], { ...options, missing: "skip" }) : [];
      if (!record) {
        return null;
      }
      await attempts.delete(record.id, options);
      return mapOAuthAttempt(record);
    },
    async deleteExpired(now) {
      return attempts.deleteWhere({ expiresAtOrBefore: requiredDateTime(now) }, { ...options, returning: "count" });
    }
  });
}

/**
 * Local auth's failed sign-ins per account email.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} failures
 * @param {object} options
 */
function signInFailureRecords(failures, options) {
  return Object.freeze({
    // Locks the email's record until the transaction ends, so concurrent failed sign-ins count one after another.
    async find(email) {
      const id = text(email);
      return id ? mapSignInFailures(await failures.lock(id, { ...options, missing: "skip" })) : null;
    },
    async save(input) {
      const email = text(input.email);
      const record = {
        failures: Number(input.failures || 0),
        lastFailedAt: requiredDateTime(input.lastFailedAt),
        lockedUntil: optionalDateTime(input.lockedUntil)
      };
      await replaceFailures(failures, email, record, options);
      return mapSignInFailures({ id: email, ...record });
    },
    async clear(email) {
      return deleteById(failures, email, options);
    },
    async deleteBefore(lastFailedAt) {
      return failures.deleteWhere({ lastFailedBefore: requiredDateTime(lastFailedAt) }, { ...options, returning: "count" });
    }
  });
}

/**
 * Local auth's registrations waiting for their email to be confirmed.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} registrations
 * @param {object} options
 */
function registrationRecords(registrations, options) {
  return Object.freeze({
    async save(input) {
      const email = text(input.email);
      const record = registrationRecord(input);
      // One statement creates the registration or replaces its fields, so two first registrations at once both land
      // and the later one stays: the registrations table has no owners, so the email, its id, keys the upsert.
      await registrations.createMany([{ id: email, ...record }], { ...options, onConflict: { keys: ["id"], action: "merge" } });
      return mapRegistration({ id: email, ...record });
    },
    async findByEmail(email) {
      return mapRegistration(await findById(registrations, email, options));
    },
    async findByTokenHash(tokenHash) {
      return mapRegistration(await findOne(registrations, "tokenHash", tokenHash, options));
    },
    async delete(email) {
      return deleteById(registrations, email, options);
    },
    async deleteExpired(now) {
      return registrations.deleteWhere({ expiresAtOrBefore: requiredDateTime(now) }, { ...options, returning: "count" });
    }
  });
}

/**
 * @typedef {object} LocalAuthHandles The handles of the tables the database backend feature owns, by resource name.
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthUsers
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthSessions
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthRecovery
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthOAuthAttempts
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthSignInFailures
 * @property {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} localAuthRegistrations
 */

/**
 * Local auth's records, every call in the given options' transaction.
 * @param {LocalAuthHandles} resources
 * @param {import("./identityStore.js").IdentityStore} identities
 * @param {object} options
 */
function createRecords(resources, identities, options) {
  return Object.freeze({
    users: userRecords(resources.localAuthUsers, options),
    sessions: sessionRecords(resources.localAuthSessions, options),
    recovery: recoveryRecords(resources.localAuthRecovery, options),
    identities: Object.freeze({
      create: (input) => identities.create(input, options),
      findByProviderSubject: (provider, providerSubject) => identities.findByProviderSubject(provider, providerSubject, options),
      listForUser: (userId) => identities.listForUser(userId, options),
      deleteForUser: (userId, provider) => identities.deleteForUser(userId, provider, options)
    }),
    oauthAttempts: oauthAttemptRecords(resources.localAuthOAuthAttempts, options),
    signInFailures: signInFailureRecords(resources.localAuthSignInFailures, options),
    registrations: registrationRecords(resources.localAuthRegistrations, options)
  });
}

/**
 * The `auth.local.backend` that keeps local auth's records in the database: each withTransaction opens one
 * transaction on the records' handles, runs it again whole on a deadlock, and hands the callback the records in it.
 * A failed callback rejects with the callback's own error (an AppError stays one); a failed commit rejects with
 * json-rest-api's RestApiWriteError.
 * @param {object} dependencies
 * @param {LocalAuthHandles} dependencies.resources
 * @param {import("./identityStore.js").IdentityStore} dependencies.identities
 */
function createLocalDbBackend({ resources, identities }) {
  const run = (callback) => resources.localAuthUsers.withTransaction({}, (txOptions) => callback(createRecords(resources, identities, txOptions)));

  // Two first failed sign-ins of one email at once both find no failure record and both create it, and the loser
  // fails with a duplicate entry. Its transaction rolled back whole, so the sign-in runs once more and then counts
  // its failure on the winner's row.
  async function withTransaction(callback) {
    try {
      return await run(callback);
    } catch (error) {
      if (error?.transactionOutcome !== "rolledBack" || !isDuplicateEntryError(error)) {
        throw error;
      }
      return run(callback);
    }
  }

  return Object.freeze({
    tables: TABLES,
    withTransaction
  });
}

/**
 * The owner APIs of local auth's accounts, sessions and recovery tokens, for
 * application code that works with them beside local auth: the
 * `auth.local.accounts`, `auth.local.sessions` and `auth.local.recovery`
 * capabilities. Each call takes the call's options last and runs in their
 * transaction (one a handle's withTransaction opened), or on its own.
 * @param {object} dependencies
 * @param {LocalAuthHandles} dependencies.resources
 * @param {import("./identityStore.js").IdentityStore} dependencies.identities
 */
function createLocalDbOwners({ resources, identities }) {
  const records = (options) => createRecords(resources, identities, options);

  // An email is kept and found as local sign-in keeps it: trimmed and in lower case.
  const accounts = Object.freeze({
    create: (input, options = {}) => records(options).users.create({ ...input, email: normalizeEmail(input?.email) }),
    findById: (userId, options = {}) => records(options).users.findById(userId),
    findByEmail: (email, options = {}) => records(options).users.findByEmail(normalizeEmail(email)),
    updatePassword: (userId, passwordRecord, options = {}) => records(options).users.updatePassword(userId, passwordRecord),
    updateProfile: (userId, updates, options = {}) => records(options).users.updateProfile(userId, updates),
    markEmailVerified: (userId, options = {}) => records(options).users.markEmailVerified(userId)
  });
  const sessions = Object.freeze({
    create: (input, options = {}) => records(options).sessions.create(input),
    update: (sessionId, changes, options = {}) => records(options).sessions.update(sessionId, changes),
    revoke: (sessionId, options = {}) => records(options).sessions.revoke(sessionId),
    // options.exceptSessionId keeps that session.
    revokeForUser: (userId, { exceptSessionId, ...options } = {}) => records(options).sessions.revokeForUser(userId, { exceptSessionId }),
    deleteExpired: (now, options = {}) => records(options).sessions.deleteExpired(now)
  });
  const recovery = Object.freeze({
    create: (input, options = {}) => records(options).recovery.create(input),
    findByTokenHash: (tokenHash, options = {}) => records(options).recovery.findByTokenHash(tokenHash),
    consume: (tokenId, options = {}) => records(options).recovery.consume(tokenId),
    consumeForUser: (userId, options = {}) => records(options).recovery.consumeForUser(userId)
  });

  return Object.freeze({
    accounts,
    sessions,
    recovery
  });
}

export { TABLES as LOCAL_AUTH_DB_TABLES, INFRASTRUCTURE_TABLES as LOCAL_AUTH_INFRASTRUCTURE_TABLES, createLocalDbBackend, createLocalDbOwners };
