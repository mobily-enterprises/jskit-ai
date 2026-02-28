import {
  normalizeCountRow,
  normalizeIdList as normalizeIdListBase,
  normalizeNullableString,
  parseJsonObject,
  stringifyJsonObject
} from "@jskit-ai/jskit-knex";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";

function resolveClient(dbClient, options = {}) {
  const trx = options && typeof options === "object" ? options.trx || null : null;
  return trx || dbClient;
}

function normalizeNullablePositiveInteger(value) {
  return parsePositiveInteger(value);
}

function normalizeIdList(values) {
  return normalizeIdListBase(values, { parseValue: parsePositiveInteger });
}

export {
  parseJsonObject,
  stringifyJsonObject,
  resolveClient,
  normalizeCountRow,
  normalizeNullableString,
  normalizeNullablePositiveInteger,
  normalizeIdList
};
