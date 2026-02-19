import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";

const ROOT_IDENTITY_ROW_ID = 1;

function mapRootIdentityRowRequired(row) {
  if (!row) {
    throw new TypeError("mapRootIdentityRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    userId: row.user_id == null ? null : Number(row.user_id),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapRootIdentityRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapRootIdentityRowRequired(row);
}

function createRootIdentityRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function ensureSingletonRow(options = {}) {
    const client = resolveClient(options);
    const now = toMysqlDateTimeUtc(new Date());

    try {
      await client("console_root_identity").insert({
        id: ROOT_IDENTITY_ROW_ID,
        user_id: null,
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
    await ensureSingletonRow(options);
    const row = await client("console_root_identity").where({ id: ROOT_IDENTITY_ROW_ID }).first();
    return mapRootIdentityRowNullable(row);
  }

  async function repoFindRootUserId(options = {}) {
    const identity = await repoFind(options);
    return identity?.userId == null ? null : Number(identity.userId);
  }

  async function repoAssignRootUserIdIfUnset(userId, options = {}) {
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return repoFindRootUserId(options);
    }

    const client = resolveClient(options);
    await ensureSingletonRow(options);

    await client("console_root_identity")
      .where({ id: ROOT_IDENTITY_ROW_ID })
      .whereNull("user_id")
      .update({
        user_id: numericUserId,
        updated_at: toMysqlDateTimeUtc(new Date())
      });

    return repoFindRootUserId(options);
  }

  return {
    find: repoFind,
    findRootUserId: repoFindRootUserId,
    assignRootUserIdIfUnset: repoAssignRootUserIdIfUnset
  };
}

const repository = createRootIdentityRepository(db);

const __testables = {
  ROOT_IDENTITY_ROW_ID,
  mapRootIdentityRowRequired,
  mapRootIdentityRowNullable,
  createRootIdentityRepository
};

export const { find, findRootUserId, assignRootUserIdIfUnset } = repository;
export { __testables };
