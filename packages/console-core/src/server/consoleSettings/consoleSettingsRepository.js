import {
  normalizeDbRecordId,
  toIsoString,
  createWithTransaction
} from "@jskit-ai/database-runtime/shared";
import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { normalizeRecordId as normalizeKernelRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { consoleSettingsFields } from "../../shared/resources/consoleSettingsFields.js";

function nowDb() {
  return toInsertDateTime();
}

function mapSettings(row = {}) {
  const settings = {};
  for (const field of consoleSettingsFields) {
    const repositoryColumn = field?.repository?.column;
    const rawValue = Object.hasOwn(row, repositoryColumn)
      ? row[repositoryColumn]
      : field.resolveDefault({
          settings: row
        });
    settings[field.key] = field.normalizeOutput(rawValue, {
      settings: row
    });
  }
  return settings;
}

function mapSingletonRow(row) {
  if (!row) {
    throw new Error("console_settings singleton row is missing.");
  }

  const ownerUserId = normalizeDbRecordId(row.owner_user_id, { fallback: null });
  return {
    id: normalizeDbRecordId(row.id, { fallback: "1" }),
    ownerUserId,
    settings: mapSettings(row),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("consoleSettingsRepository requires knex.");
  }
  const withTransaction = createWithTransaction(knex);

  async function readSingleton(client) {
    return client("console_settings").where({ id: 1 }).first();
  }

  async function getSingleton(options = {}) {
    const client = options?.trx || knex;
    return mapSingletonRow(await readSingleton(client));
  }

  async function ensureOwnerUserId(userId, options = {}) {
    const client = options?.trx || knex;
    const candidateOwnerUserId = normalizeKernelRecordId(userId, { fallback: null });
    if (!candidateOwnerUserId) {
      throw new TypeError("consoleSettingsRepository.ensureOwnerUserId requires a positive user id.");
    }

    const current = mapSingletonRow(await readSingleton(client));
    if (current.ownerUserId) {
      return current.ownerUserId;
    }

    await client("console_settings")
      .where({ id: 1 })
      .whereNull("owner_user_id")
      .update({
        owner_user_id: candidateOwnerUserId,
        updated_at: nowDb()
      });

    const reloaded = mapSingletonRow(await readSingleton(client));
    if (!reloaded.ownerUserId) {
      throw new Error("console_settings owner_user_id could not be resolved.");
    }

    return reloaded.ownerUserId;
  }

  async function updateSingleton(patch, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(patch);
    const dbPatch = {
      updated_at: nowDb()
    };

    for (const field of consoleSettingsFields) {
      if (!Object.hasOwn(source, field.key)) {
        continue;
      }
      dbPatch[field.repository.column] = field.normalizeInput(source[field.key], {
        payload: source
      });
    }

    await client("console_settings")
      .where({ id: 1 })
      .update(dbPatch);

    return getSingleton({ trx: client });
  }

  return Object.freeze({
    withTransaction,
    getSingleton,
    ensureOwnerUserId,
    updateSingleton
  });
}

export { createRepository };
