import {
  findDuplicateEntryError,
  isLostDuplicateInsertRace,
  normalizeDbRecordId,
  toIsoString
} from "@jskit-ai/database-runtime/shared";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
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

// The base, then base-2 to base-1000.
const USERNAME_CANDIDATE_LIMIT = 1000;

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
 * The username a profile gets: the base, or the first of base-2 to base-1000
 * no other profile holds.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} userProfiles
 * @param {string} baseUsername
 * @param {unknown} excludeUserId The profile whose own username stays available to it.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
 */
async function resolveUniqueUsername(userProfiles, baseUsername, excludeUserId, options) {
  const normalizedExcludeUserId = normalizeDbRecordId(excludeUserId, { fallback: null });
  const candidates = Array.from(
    { length: USERNAME_CANDIDATE_LIMIT },
    (_, suffix) => buildUsernameCandidate(baseUsername, suffix)
  );

  // One read of every profile holding a candidate, however many namesakes came before.
  const existingRows = await userProfiles.queryAll({ filters: { usernames: candidates } }, options);
  const holderIdByUsername = new Map(
    existingRows.map((row) => [normalizeLowerText(row.username), normalizeDbRecordId(row.id, { fallback: null })])
  );

  const candidate = candidates.find((username) => (
    !holderIdByUsername.has(username) || holderIdByUsername.get(username) === normalizedExcludeUserId
  ));
  if (candidate) {
    return candidate;
  }

  throw new Error("Unable to generate unique username.");
}

/**
 * The `users.profiles` capability: the users table's records. Every method
 * takes the caller's options last and joins their transaction. Its reads
 * `query`, `get` and `pageLimits` also serve a CRUD feature that names it as
 * its `ownerRepository`.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.userProfiles The users table's handle.
 * @param {import("../../types.js").UserSettingsRepository} dependencies.userSettings The settings that
 *   createWithSettings writes beside a profile.
 */
function createRepository({ userProfiles, userSettings }) {
  async function countProfiles(filters, options) {
    const rows = await userProfiles.aggregate({ measures: { count: { count: "*" } }, filters }, options);
    return Number(rows?.[0]?.count || 0);
  }

  async function queryFirst(filters, options) {
    const { records } = await userProfiles.query({ filters, page: { size: 1 } }, options);
    return records[0] || null;
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

  // A profile's changed fields, stamped with the update time; null for a missing id or profile.
  async function patchProfile(userId, changes, options) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    return normalizeProfileRecord(await userProfiles.patch(
      normalizedUserId,
      { ...changes, updatedAt: new Date().toISOString() },
      { ...options, missing: "skip" }
    ));
  }

  async function updateDisplayNameById(userId, displayName, options = {}) {
    return patchProfile(userId, { displayName }, options);
  }

  async function updateAvatarById(userId, avatar = {}, options = {}) {
    return patchProfile(userId, {
      avatarStorageKey: avatar.avatarStorageKey ?? null,
      avatarVersion: avatar.avatarVersion ?? null,
      avatarUpdatedAt: toIsoString(avatar.avatarUpdatedAt ?? new Date())
    }, options);
  }

  async function clearAvatarById(userId, options = {}) {
    return patchProfile(userId, {
      avatarStorageKey: null,
      avatarVersion: null,
      avatarUpdatedAt: null
    }, options);
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

    const executeUpsert = async (txOptions) => {
      const existing = await findByIdentity(identity, txOptions);

      if (existing) {
        const existingUsername = normalizeUsername(existing.username);
        const username = existingUsername || (
          await resolveUniqueUsername(
            userProfiles,
            requestedUsername || usernameBaseFromEmail(email),
            existing.id,
            txOptions
          )
        );

        return patchProfile(existing.id, { email, displayName, username }, txOptions);
      }

      const username = await resolveUniqueUsername(
        userProfiles,
        requestedUsername || usernameBaseFromEmail(email),
        null,
        txOptions
      );

      return normalizeProfileRecord(await userProfiles.create(
        {
          authProvider: identity.provider,
          authProviderUserSid: identity.providerUserId,
          email,
          displayName,
          username,
          createdAt: new Date().toISOString()
        },
        txOptions
      ));
    };

    try {
      return await userProfiles.withTransaction(options, executeUpsert);
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

  /**
   * Creates (or, for an identity that already has one, updates) a profile and
   * gives it its settings, in one transaction: the caller's, or one it opens.
   * Settings start from the defaults; the given fields replace them.
   * @param {{ profile: object, settings?: object }} input
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   */
  async function createWithSettings({ profile, settings = {} }, options = {}) {
    return userProfiles.withTransaction(options, async (txOptions) => {
      const created = await upsert(profile, txOptions);
      return {
        profile: created,
        settings: await userSettings.patchUserSettings(created.id, settings, txOptions)
      };
    });
  }

  /**
   * The number of users, leaving out `excludeIds` and, with `createdSince`,
   * those created before it.
   * @param {{ excludeIds?: readonly unknown[], createdSince?: Date | string | null }} [criteria]
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   */
  async function countUsers({ excludeIds = [], createdSince = null } = {}, options = {}) {
    const filters = createdSince == null ? {} : { createdSince: toIsoString(createdSince) };
    const ids = [...new Set(excludeIds.map((id) => normalizeDbRecordId(id, { fallback: null })).filter(Boolean))];
    const total = await countProfiles(filters, options);
    // The ids filter has no "not in": the excluded users who match are subtracted.
    return ids.length < 1 ? total : total - await countProfiles({ ...filters, ids }, options);
  }

  return Object.freeze({
    withTransaction: userProfiles.withTransaction,
    findById,
    findByEmail,
    findByIdentity,
    updateDisplayNameById,
    updateAvatarById,
    clearAvatarById,
    upsert,
    createWithSettings,
    countUsers,
    // The CRUD surface's reads (a CRUD feature serving the users table names this repository as its ownerRepository).
    query: userProfiles.query,
    get: userProfiles.get,
    pageLimits: userProfiles.pageLimits
  });
}

export { createRepository };
