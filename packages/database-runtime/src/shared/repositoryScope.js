import { resolveRepoClient } from "./repositoryOptions.js";
import { applyVisibility, applyVisibilityOwners } from "./visibility.js";

function normalizeTableName(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError("createRepositoryScope requires tableName.");
  }
  return normalized;
}

function normalizeIdColumn(value) {
  const normalized = String(value || "").trim();
  return normalized || "id";
}

function createRepositoryScope(knex, tableName, options = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("createRepositoryScope requires knex.");
  }

  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const resolvedTableName = normalizeTableName(tableName);
  const resolvedIdColumn = normalizeIdColumn(source.idColumn);

  function clientOf(queryOptions = {}) {
    return resolveRepoClient(knex, queryOptions);
  }

  function table(queryOptions = {}) {
    return clientOf(queryOptions)(resolvedTableName);
  }

  function applyToQuery(queryBuilder, queryOptions = {}) {
    return applyVisibility(queryBuilder, queryOptions.visibilityContext);
  }

  function scoped(queryOptions = {}) {
    return applyToQuery(table(queryOptions), queryOptions);
  }

  function scopedById(recordId, queryOptions = {}) {
    return scoped(queryOptions).where(resolvedIdColumn, recordId);
  }

  function withOwners(payload = {}, queryOptions = {}) {
    return applyVisibilityOwners(payload, queryOptions.visibilityContext);
  }

  return Object.freeze({
    tableName: resolvedTableName,
    idColumn: resolvedIdColumn,
    clientOf,
    table,
    applyToQuery,
    scoped,
    scopedById,
    withOwners
  });
}

export { createRepositoryScope };
