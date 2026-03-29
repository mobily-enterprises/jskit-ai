import { normalizeText } from "./normalize.js";
import { normalizePathname } from "../surface/paths.js";

const DEFAULT_CRUD_LOOKUP_CONTAINER_KEY = "lookups";

function normalizeCrudLookupApiPath(value = "") {
  const normalized = normalizePathname(normalizeText(value));
  if (!normalized || normalized === "/") {
    return "";
  }

  return normalized;
}

function normalizeCrudLookupContainerKey(
  value,
  {
    defaultValue = DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
    context = "crud lookup container key"
  } = {}
) {
  if (value === undefined || value === null || value === "") {
    return normalizeText(defaultValue) || DEFAULT_CRUD_LOOKUP_CONTAINER_KEY;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }

  return normalized;
}

function resolveCrudLookupContainerKey(resource = {}, options = {}) {
  const source = resource && typeof resource === "object" && !Array.isArray(resource) ? resource : {};
  const contract = source.contract;
  if (contract !== undefined && contract !== null && (typeof contract !== "object" || Array.isArray(contract))) {
    throw new TypeError("crud resource contract must be an object when provided.");
  }

  const lookup = contract?.lookup;
  if (lookup !== undefined && lookup !== null && (typeof lookup !== "object" || Array.isArray(lookup))) {
    throw new TypeError("crud resource contract.lookup must be an object when provided.");
  }

  return normalizeCrudLookupContainerKey(lookup?.containerKey, options);
}

export {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupApiPath,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey
};
