import { resolveInsertedRecordId } from "@jskit-ai/database-runtime/shared";
import { normalizeDbRecordId } from "@jskit-ai/database-runtime/shared/repositoryOptions";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { parseJsonObject } from "@jskit-ai/assistant-core/shared";

function normalizeWorkspaceId(value) {
  return normalizeRecordId(value, { fallback: null });
}

function normalizeDbWorkspaceId(value) {
  return normalizeDbRecordId(value, { fallback: null });
}

function normalizeInputRecordId(value) {
  return normalizeRecordId(value, { fallback: null });
}

function applyWorkspaceScope(query, columnName, workspaceId) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    return query.where(columnName, normalizedWorkspaceId);
  }

  return query.whereNull(columnName);
}


function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function resolveInsertedId(insertResult) {
  return resolveInsertedRecordId(insertResult, { fallback: "" }) || "";
}

export {
  applyWorkspaceScope,
  normalizeDbWorkspaceId,
  normalizeInputRecordId,
  normalizeWorkspaceId,
  parseJsonObject,
  stringifyJsonObject,
  toIso,
  resolveInsertedId
};
