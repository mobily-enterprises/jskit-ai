import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../lib/primitives/mysqlErrors.js";

function mapUserSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapUserSettingsRowRequired expected a row object.");
  }

  return {
    userId: Number(row.user_id),
    lastActiveWorkspaceId: row.last_active_workspace_id == null ? null : Number(row.last_active_workspace_id),
    theme: row.theme,
    locale: row.locale,
    timeZone: row.time_zone,
    dateFormat: row.date_format,
    numberFormat: row.number_format,
    currencyCode: row.currency_code,
    defaultMode: row.default_mode,
    defaultTiming: row.default_timing,
    defaultPaymentsPerYear: Number(row.default_payments_per_year),
    defaultHistoryPageSize: Number(row.default_history_page_size),
    avatarSize: Number(row.avatar_size ?? 64),
    passwordSignInEnabled: row.password_sign_in_enabled == null ? true : Boolean(row.password_sign_in_enabled),
    passwordSetupRequired: row.password_setup_required == null ? false : Boolean(row.password_setup_required),
    productUpdates: Boolean(row.notify_product_updates),
    accountActivity: Boolean(row.notify_account_activity),
    securityAlerts: Boolean(row.notify_security_alerts),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapUserSettingsRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapUserSettingsRowRequired(row);
}

function buildPreferencesUpdatePatch(patch) {
  const dbPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch, "theme")) {
    dbPatch.theme = patch.theme;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "locale")) {
    dbPatch.locale = patch.locale;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "timeZone")) {
    dbPatch.time_zone = patch.timeZone;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "dateFormat")) {
    dbPatch.date_format = patch.dateFormat;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "numberFormat")) {
    dbPatch.number_format = patch.numberFormat;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "currencyCode")) {
    dbPatch.currency_code = patch.currencyCode;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultMode")) {
    dbPatch.default_mode = patch.defaultMode;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultTiming")) {
    dbPatch.default_timing = patch.defaultTiming;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultPaymentsPerYear")) {
    dbPatch.default_payments_per_year = patch.defaultPaymentsPerYear;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultHistoryPageSize")) {
    dbPatch.default_history_page_size = patch.defaultHistoryPageSize;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "avatarSize")) {
    dbPatch.avatar_size = patch.avatarSize;
  }

  return dbPatch;
}

function buildNotificationsUpdatePatch(patch) {
  const dbPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch, "productUpdates")) {
    dbPatch.notify_product_updates = patch.productUpdates;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "accountActivity")) {
    dbPatch.notify_account_activity = patch.accountActivity;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "securityAlerts")) {
    dbPatch.notify_security_alerts = patch.securityAlerts;
  }

  return dbPatch;
}

function withUpdatedAt(patch, now = new Date()) {
  return {
    ...patch,
    updated_at: toMysqlDateTimeUtc(now)
  };
}

function createUserSettingsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoFindByUserId(userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowNullable(row);
  }

  async function repoEnsureForUserId(userId, options = {}) {
    const client = resolveClient(options);
    const existing = await repoFindByUserId(userId, options);
    if (existing) {
      return existing;
    }

    try {
      await client("user_settings").insert({ user_id: userId });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoUpdatePreferences(userId, patch) {
    const ensured = await repoEnsureForUserId(userId);
    const dbPatch = buildPreferencesUpdatePatch(patch);

    if (!Object.keys(dbPatch).length) {
      return ensured;
    }

    await dbClient("user_settings").where({ user_id: userId }).update(withUpdatedAt(dbPatch));

    const row = await dbClient("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoUpdateNotifications(userId, patch) {
    const ensured = await repoEnsureForUserId(userId);
    const dbPatch = buildNotificationsUpdatePatch(patch);

    if (!Object.keys(dbPatch).length) {
      return ensured;
    }

    await dbClient("user_settings").where({ user_id: userId }).update(withUpdatedAt(dbPatch));

    const row = await dbClient("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoUpdatePasswordSignInEnabled(userId, enabled, options = {}) {
    await repoEnsureForUserId(userId);
    const dbPatch = {
      password_sign_in_enabled: Boolean(enabled)
    };
    if (Object.prototype.hasOwnProperty.call(options, "passwordSetupRequired")) {
      dbPatch.password_setup_required = Boolean(options.passwordSetupRequired);
    }

    await dbClient("user_settings").where({ user_id: userId }).update(withUpdatedAt(dbPatch));

    const row = await dbClient("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoUpdatePasswordSetupRequired(userId, required) {
    await repoEnsureForUserId(userId);

    await dbClient("user_settings")
      .where({ user_id: userId })
      .update(
        withUpdatedAt({
          password_setup_required: Boolean(required)
        })
      );

    const row = await dbClient("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoFindByUserIdForUpdate(userId, trx = null) {
    const client = trx || dbClient;
    const row = await client("user_settings").where({ user_id: userId }).forUpdate().first();
    return mapUserSettingsRowNullable(row);
  }

  async function repoUpdateLastActiveWorkspaceId(userId, workspaceId, options = {}) {
    const client = resolveClient(options);
    await repoEnsureForUserId(userId, options);

    await client("user_settings")
      .where({ user_id: userId })
      .update(
        withUpdatedAt({
          last_active_workspace_id: workspaceId == null ? null : Number(workspaceId)
        })
      );

    const row = await client("user_settings").where({ user_id: userId }).first();
    return mapUserSettingsRowRequired(row);
  }

  return {
    findByUserId: repoFindByUserId,
    ensureForUserId: repoEnsureForUserId,
    updatePreferences: repoUpdatePreferences,
    updateNotifications: repoUpdateNotifications,
    updatePasswordSignInEnabled: repoUpdatePasswordSignInEnabled,
    updatePasswordSetupRequired: repoUpdatePasswordSetupRequired,
    findByUserIdForUpdate: repoFindByUserIdForUpdate,
    updateLastActiveWorkspaceId: repoUpdateLastActiveWorkspaceId
  };
}

const repository = createUserSettingsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapUserSettingsRowRequired,
  mapUserSettingsRowNullable,
  buildPreferencesUpdatePatch,
  buildNotificationsUpdatePatch,
  withUpdatedAt,
  createUserSettingsRepository
};

export const {
  findByUserId,
  ensureForUserId,
  updatePreferences,
  updateNotifications,
  updatePasswordSignInEnabled,
  updatePasswordSetupRequired,
  findByUserIdForUpdate,
  updateLastActiveWorkspaceId
} = repository;
export { __testables };
