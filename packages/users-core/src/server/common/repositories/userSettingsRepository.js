import {
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";
import {
  userSettingsFields
} from "../../../shared/resources/userSettingsFields.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  const mapped = {
    userId: Number(row.user_id),
    passwordSignInEnabled: row.password_sign_in_enabled == null ? true : Boolean(row.password_sign_in_enabled),
    passwordSetupRequired: row.password_setup_required == null ? false : Boolean(row.password_setup_required),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };

  for (const field of userSettingsFields) {
    const value = Object.hasOwn(row, field.dbColumn)
      ? row[field.dbColumn]
      : field.resolveDefault({
          settings: mapped,
          row
        });
    mapped[field.key] = field.normalizeOutput(value, {
      settings: mapped,
      row
    });
  }

  return mapped;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return value === true;
}

function createInsertPayload(userId) {
  const payload = {
    user_id: Number(userId),
    password_sign_in_enabled: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
    password_setup_required: DEFAULT_USER_SETTINGS.passwordSetupRequired,
    created_at: nowDb(),
    updated_at: nowDb()
  };

  const resolvedDefaults = {};
  for (const field of userSettingsFields) {
    const defaultValue = field.resolveDefault({
      settings: resolvedDefaults
    });
    payload[field.dbColumn] = field.normalizeInput(defaultValue, {
      payload: resolvedDefaults,
      settings: resolvedDefaults
    });
    resolvedDefaults[field.key] = field.normalizeOutput(defaultValue, {
      settings: resolvedDefaults
    });
  }

  return payload;
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("userSettingsRepository requires knex.");
  }

  async function findByUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("user_settings").where({ user_id: Number(userId) }).first();
    return mapRow(row);
  }

  async function ensureForUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const numericUserId = Number(userId);
    const existing = await findByUserId(numericUserId, { trx: client });
    if (existing) {
      return existing;
    }

    try {
      await client("user_settings").insert(createInsertPayload(numericUserId));
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByUserId(numericUserId, { trx: client });
  }

  async function patchUserSettings(userId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const ensured = await ensureForUserId(userId, { trx: client });
    const source = patch && typeof patch === "object" ? patch : {};

    const dbPatch = {
      updated_at: nowDb()
    };

    for (const field of userSettingsFields) {
      if (!Object.hasOwn(source, field.key)) {
        continue;
      }
      dbPatch[field.dbColumn] = field.normalizeInput(source[field.key], {
        payload: source,
        settings: ensured
      });
    }

    if (Object.hasOwn(source, "passwordSignInEnabled")) {
      dbPatch.password_sign_in_enabled = normalizeBoolean(source.passwordSignInEnabled, ensured.passwordSignInEnabled);
    }
    if (Object.hasOwn(source, "passwordSetupRequired")) {
      dbPatch.password_setup_required = normalizeBoolean(source.passwordSetupRequired, ensured.passwordSetupRequired);
    }
    await client("user_settings").where({ user_id: Number(userId) }).update(dbPatch);
    return findByUserId(userId, { trx: client });
  }

  async function updatePreferences(userId, patch = {}, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  async function updateNotifications(userId, patch = {}, options = {}) {
    return patchUserSettings(userId, patch, options);
  }

  async function updatePasswordSignInEnabled(userId, enabled, options = {}) {
    return patchUserSettings(
      userId,
      {
        passwordSignInEnabled: enabled,
        passwordSetupRequired: Object.hasOwn(options, "passwordSetupRequired")
          ? options.passwordSetupRequired
          : undefined
      },
      options
    );
  }

  async function updatePasswordSetupRequired(userId, required, options = {}) {
    return patchUserSettings(userId, { passwordSetupRequired: required }, options);
  }

  return Object.freeze({
    findByUserId,
    ensureForUserId,
    patchUserSettings,
    updatePreferences,
    updateNotifications,
    updatePasswordSignInEnabled,
    updatePasswordSetupRequired
  });
}

export { createRepository, mapRow };
