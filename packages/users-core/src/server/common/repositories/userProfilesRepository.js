import {
  findDuplicateEntryError,
  isLostDuplicateInsertRace,
  joinOrOpenTransaction,
  normalizeDbRecordId,
  resolveTransaction,
  retryDeadlocks,
  toIsoString
} from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createJsonRestContext,
  extractJsonRestCollectionRows
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { normalizeIdentity } from "../support/identity.js";
import { USERNAME_MAX_LENGTH, normalizeNullableString, normalizeNullableVersion, normalizeUsername } from "../../../shared/resources/userProfileValues.js";

function normalizeProfileRecord(payload = null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    id: normalizeDbRecordId(payload.id, { fallback: null }),
    authProvider: normalizeLowerText(payload.authProvider),
    authProviderUserSid: normalizeText(payload.authProviderUserSid),
    email: normalizeLowerText(payload.email),
    username: normalizeUsername(payload.username),
    displayName: normalizeText(payload.displayName),
    avatarStorageKey: normalizeNullableString(payload.avatarStorageKey),
    avatarVersion: normalizeNullableVersion(payload.avatarVersion),
    avatarUpdatedAt: payload.avatarUpdatedAt ? toIsoString(payload.avatarUpdatedAt) : null,
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null
  };
}

function normalizeCreatePayload(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const normalized = {};

  if (Object.hasOwn(source, "authProvider") || Object.hasOwn(source, "provider")) {
    normalized.authProvider = normalizeLowerText(source.authProvider ?? source.provider);
  }
  if (Object.hasOwn(source, "authProviderUserSid") || Object.hasOwn(source, "providerUserId")) {
    normalized.authProviderUserSid = normalizeText(source.authProviderUserSid ?? source.providerUserId);
  }
  if (Object.hasOwn(source, "email")) {
    normalized.email = normalizeLowerText(source.email);
  }
  if (Object.hasOwn(source, "username")) {
    normalized.username = normalizeUsername(source.username);
  }
  if (Object.hasOwn(source, "displayName")) {
    normalized.displayName = normalizeText(source.displayName);
  }
  if (Object.hasOwn(source, "avatarStorageKey")) {
    normalized.avatarStorageKey = normalizeNullableString(source.avatarStorageKey);
  }
  if (Object.hasOwn(source, "avatarVersion")) {
    normalized.avatarVersion = normalizeNullableVersion(source.avatarVersion);
  }
  if (Object.hasOwn(source, "avatarUpdatedAt")) {
    normalized.avatarUpdatedAt = source.avatarUpdatedAt == null ? null : toIsoString(source.avatarUpdatedAt);
  }

  return normalized;
}

function usernameBaseFromEmail(email) {
  const normalizedEmail = normalizeLowerText(email);
  const emailLocalPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail;
  const username = normalizeUsername(emailLocalPart);
  return username || "user";
}

function buildUsernameCandidate(baseUsername, suffix) {
  const normalizedBase = normalizeUsername(baseUsername) || "user";
  if (suffix < 1) {
    return normalizedBase;
  }

  const suffixText = `-${suffix + 1}`;
  const allowedBaseLength = USERNAME_MAX_LENGTH - suffixText.length;
  const trimmedBase = normalizedBase.slice(0, allowedBaseLength);
  return `${trimmedBase}${suffixText}`;
}

function duplicateTargetsEmail(error) {
  const duplicate = findDuplicateEntryError(error);
  if (!duplicate) {
    return false;
  }

  const message = normalizeLowerText(duplicate.sqlMessage || duplicate.message);
  return message.includes("email");
}

function duplicateTargetsUsername(error) {
  const duplicate = findDuplicateEntryError(error);
  if (!duplicate) {
    return false;
  }

  const message = normalizeLowerText(duplicate.sqlMessage || duplicate.message);
  return message.includes("username");
}

function buildDuplicateEmailConflictError(cause) {
  const error = new Error("Email is already linked to a different profile.", { cause });
  error.transactionOutcome = cause.transactionOutcome;
  error.code = "USER_PROFILE_EMAIL_CONFLICT";
  return error;
}

/**
 * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} api
 * @param {string} baseUsername
 * @param {{ excludeUserId?: unknown, transaction?: object | null }} [options]
 */
async function resolveUniqueUsername(api, baseUsername, { excludeUserId = null, transaction = null } = {}) {
  const normalizedExcludeUserId = normalizeDbRecordId(excludeUserId, { fallback: null });

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildUsernameCandidate(baseUsername, suffix);
    const existingRows = extractJsonRestCollectionRows(
      await api.resources.userProfiles.query({
        queryParams: {
          filters: {
            username: candidate
          }
        },
        transaction,
        format: "plain"
      })
    );
    const existing = existingRows[0] || null;
    const existingId = normalizeDbRecordId(existing?.id, { fallback: null });
    if (!existing || existingId === normalizedExcludeUserId) {
      return candidate;
    }
  }

  throw new Error("Unable to generate unique username.");
}

/** @param {{ api: import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi }} dependencies */
function createRepository({ api }) {
  const withTransaction = (work) => retryDeadlocks(() => api.transaction(work));

  async function queryFirst(filters = {}, options = {}) {
    const rows = extractJsonRestCollectionRows(
      await api.resources.userProfiles.query(
        {
          queryParams: {
            filters
          },
          transaction: resolveTransaction(options),
          format: "plain"
        },
        createJsonRestContext(options.context)
      )
    );

    return rows[0] || null;
  }

  async function findById(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return normalizeProfileRecord(await queryFirst({ id: normalizedUserId }, options));
  }

  async function findByEmail(email, options = {}) {
    const normalizedEmail = normalizeCreatePayload({ email }).email || "";
    if (!normalizedEmail) {
      return null;
    }

    return normalizeProfileRecord(await queryFirst({ email: normalizedEmail }, options));
  }

  async function findByIdentity(identityLike, options = {}) {
    const identity = normalizeIdentity(identityLike);
    if (!identity) {
      return null;
    }

    return normalizeProfileRecord(
      await queryFirst(
        {
          authProvider: identity.provider,
          authProviderUserSid: identity.providerUserId
        },
        options
      )
    );
  }

  async function updateDisplayNameById(userId, displayName, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const updated = await api.resources.userProfiles.patch(
      {
        id: normalizedUserId,
        data: {
          displayName,
          updatedAt: new Date().toISOString()
        },
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return normalizeProfileRecord(updated);
  }

  async function updateAvatarById(userId, avatar = {}, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const updated = await api.resources.userProfiles.patch(
      {
        id: normalizedUserId,
        data: {
          avatarStorageKey: avatar.avatarStorageKey ?? null,
          avatarVersion: avatar.avatarVersion ?? null,
          avatarUpdatedAt: toIsoString(avatar.avatarUpdatedAt ?? new Date()),
          updatedAt: new Date().toISOString()
        },
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return normalizeProfileRecord(updated);
  }

  async function clearAvatarById(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const updated = await api.resources.userProfiles.patch(
      {
        id: normalizedUserId,
        data: {
          avatarStorageKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
          updatedAt: new Date().toISOString()
        },
        format: "plain",
        returning: "full",
        transaction: resolveTransaction(options)
      },
      createJsonRestContext(options.context)
    );

    return normalizeProfileRecord(updated);
  }

  async function upsert(profileLike = {}, options = {}) {
    const normalizedPayload = normalizeCreatePayload(profileLike);
    const identity = normalizeIdentity({
      provider: normalizedPayload.authProvider,
      providerUserId: normalizedPayload.authProviderUserSid
    });
    if (!identity) {
      throw new TypeError("upsert requires provider/authProvider and providerUserId/authProviderUserSid.");
    }

    const email = normalizedPayload.email || "";
    const displayName = normalizedPayload.displayName || "";
    const requestedUsername = normalizeUsername(normalizedPayload.username);
    if (!email || !displayName) {
      throw new TypeError("upsert requires email and displayName.");
    }

    const executeUpsert = async (trx) => {
      const existing = await findByIdentity(identity, {
        trx,
        context: options.context
      });

      if (existing) {
        const existingUsername = normalizeUsername(existing.username);
        const username = existingUsername || (
          await resolveUniqueUsername(
            api,
            requestedUsername || usernameBaseFromEmail(email),
            { excludeUserId: existing.id, transaction: trx }
          )
        );

        const updated = await api.resources.userProfiles.patch(
          {
            id: normalizeDbRecordId(existing.id, { fallback: null }),
            data: {
              email,
              displayName,
              username,
              updatedAt: new Date().toISOString()
            },
            format: "plain",
            returning: "full",
            transaction: trx
          },
          createJsonRestContext(options.context)
        );

        return normalizeProfileRecord(updated);
      }

      const username = await resolveUniqueUsername(
        api,
        requestedUsername || usernameBaseFromEmail(email),
        { transaction: trx }
      );

      const created = await api.resources.userProfiles.post(
        {
          data: {
            authProvider: identity.provider,
            authProviderUserSid: identity.providerUserId,
            email,
            displayName,
            username,
            createdAt: new Date().toISOString()
          },
          format: "plain",
          returning: "full",
          transaction: trx
        },
        createJsonRestContext(options.context)
      );

      return normalizeProfileRecord(created);
    };

    try {
      return await joinOrOpenTransaction(options, withTransaction, executeUpsert);
    } catch (error) {
      if (["pending", "rolledBack"].includes(error?.transactionOutcome) && duplicateTargetsEmail(error)) {
        throw buildDuplicateEmailConflictError(error);
      }
      // A failed participant cannot recover inside the caller's transaction.
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
      if (duplicateTargetsUsername(error)) {
        throw error;
      }
      const existing = await findByIdentity(identity, { context: options.context });
      if (existing) {
        return existing;
      }
      throw error;
    }
  }

  return Object.freeze({
    withTransaction,
    findById,
    findByEmail,
    findByIdentity,
    updateDisplayNameById,
    updateAvatarById,
    clearAvatarById,
    upsert
  });
}

export { createRepository };
