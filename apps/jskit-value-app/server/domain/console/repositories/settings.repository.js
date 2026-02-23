import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";

const CONSOLE_SETTINGS_SINGLETON_ID = 1;

function parseJsonValue(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapConsoleSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapConsoleSettingsRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    features: parseJsonValue(row.features_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapConsoleSettingsRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapConsoleSettingsRowRequired(row);
}

function toDbJson(value) {
  if (value == null) {
    return JSON.stringify({});
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function createConsoleSettingsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function ensureSingleton(options = {}) {
    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());
    try {
      await client("console_settings").insert({
        id: CONSOLE_SETTINGS_SINGLETON_ID,
        features_json: toDbJson({}),
        created_at: now,
        updated_at: now
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }
  }

  async function repoFind(options = {}) {
    const client = resolveClient(options);
    await ensureSingleton(options);
    const row = await client("console_settings").where({ id: CONSOLE_SETTINGS_SINGLETON_ID }).first();
    return mapConsoleSettingsRowNullable(row);
  }

  async function repoEnsure(options = {}) {
    const settings = await repoFind(options);
    if (settings) {
      return settings;
    }

    throw new TypeError("console settings row could not be resolved.");
  }

  async function repoUpdate(patch = {}, options = {}) {
    const client = resolveClient(options);
    const normalizedPatch = patch && typeof patch === "object" ? patch : {};

    const dbPatch = {};
    if (Object.hasOwn(normalizedPatch, "features")) {
      dbPatch.features_json = toDbJson(normalizedPatch.features || {});
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await ensureSingleton(options);
      await client("console_settings").where({ id: CONSOLE_SETTINGS_SINGLETON_ID }).update(dbPatch);
    }

    const row = await client("console_settings").where({ id: CONSOLE_SETTINGS_SINGLETON_ID }).first();
    return mapConsoleSettingsRowRequired(row);
  }

  return {
    find: repoFind,
    ensure: repoEnsure,
    update: repoUpdate
  };
}

const repository = createConsoleSettingsRepository(db);

const __testables = {
  CONSOLE_SETTINGS_SINGLETON_ID,
  parseJsonValue,
  mapConsoleSettingsRowRequired,
  mapConsoleSettingsRowNullable,
  createConsoleSettingsRepository
};

export const { find, ensure, update } = repository;
export { __testables };
