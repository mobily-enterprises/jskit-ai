import { resolveInsertedRecordId } from "@jskit-ai/database-runtime/shared";
import { parseJsonObject } from "../../shared/support/jsonObject.js";

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

export { parseJsonObject, stringifyJsonObject, toIso, resolveInsertedId };
