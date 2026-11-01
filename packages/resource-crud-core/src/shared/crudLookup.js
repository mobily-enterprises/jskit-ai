import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toCamelCase } from "@jskit-ai/kernel/shared/support/stringCase";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import {
  CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE,
  buildCrudFieldContractMap,
  resolveCrudFieldSchemaProperties
} from "./crudFieldContract.js";

const DEFAULT_CRUD_LOOKUP_CONTAINER_KEY = "lookups";

function normalizeCrudLookupApiPath(value = "") {
  const normalized = normalizePathname(normalizeText(value));
  if (!normalized || normalized === "/") {
    return "";
  }

  return normalized;
}

function normalizeCrudLookupNamespace(value = "") {
  const normalizedApiPath = normalizeCrudLookupApiPath(value);
  if (!normalizedApiPath) {
    return "";
  }

  return normalizedApiPath.slice(1);
}

function resolveCrudLookupApiPathFromNamespace(value = "") {
  const normalizedNamespace = normalizeCrudLookupNamespace(value);
  if (!normalizedNamespace) {
    return "";
  }

  return `/${normalizedNamespace}`;
}

function resolveCrudResourceScopeName(value = "") {
  const normalizedNamespace = normalizeCrudLookupNamespace(value);
  if (!normalizedNamespace) {
    return "";
  }

  return toCamelCase(normalizedNamespace.replace(/\//g, "-"));
}

function usesCrudLookupShorthand(fieldDefinition) {
  return isRecord(fieldDefinition) && typeof fieldDefinition.lookup === "string";
}

/**
 * A schema field written with `lookup: "<namespace>"`, expanded where `lookup`
 * stood into a lookup `relation` on that namespace's `id`, `belongsTo` its JSON
 * REST resource, `as` the field key without its `Id` suffix, and an autocomplete
 * `ui.formControl`. Keys the field also writes win; inside `relation` and `ui`
 * they are merged over the filled-in ones.
 * @param {string} fieldKey
 * @param {Record<string, any>} fieldDefinition
 */
function expandCrudLookupField(fieldKey, fieldDefinition) {
  const namespace = normalizeCrudLookupNamespace(fieldDefinition.lookup);
  if (!namespace) {
    throw new TypeError(`defineCrudResource schema.${fieldKey}.lookup must name the namespace it looks up.`);
  }
  const relationshipName = fieldDefinition.as ?? (/.Id$/u.test(fieldKey) ? fieldKey.slice(0, -2) : "");
  if (!relationshipName) {
    throw new TypeError(`defineCrudResource schema.${fieldKey} has no "Id" suffix, so its lookup must name its relationship with as.`);
  }
  const filled = {
    relation: { kind: "lookup", namespace, valueKey: "id", ...normalizeObject(fieldDefinition.relation) },
    belongsTo: fieldDefinition.belongsTo ?? resolveCrudResourceScopeName(namespace),
    as: relationshipName,
    ui: { formControl: CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE, ...normalizeObject(fieldDefinition.ui) }
  };
  const expanded = {};
  for (const [key, value] of Object.entries(fieldDefinition)) {
    if (key !== "lookup") {
      expanded[key] = Object.hasOwn(filled, key) ? filled[key] : value;
      continue;
    }
    for (const [filledKey, filledValue] of Object.entries(filled)) {
      if (!Object.hasOwn(fieldDefinition, filledKey)) {
        expanded[filledKey] = filledValue;
      }
    }
  }
  return expanded;
}

/**
 * A resource schema with each `lookup: "<namespace>"` field expanded, or the
 * schema itself when no field uses the shorthand.
 * @param {unknown} schema
 */
function expandCrudLookupFields(schema) {
  if (!isRecord(schema) || !Object.values(schema).some(usesCrudLookupShorthand)) {
    return schema;
  }
  return Object.fromEntries(Object.entries(schema).map(([fieldKey, fieldDefinition]) => [
    fieldKey,
    usesCrudLookupShorthand(fieldDefinition) ? expandCrudLookupField(fieldKey, fieldDefinition) : fieldDefinition
  ]));
}

function normalizeCrudLookupContainerKey(
  value,
  {
    defaultValue = DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
    context = "crud lookup container key"
  } = {}
) {
  if (value === undefined || value === null || value === "") {
    return normalizeText(defaultValue);
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }

  return normalized;
}

function isCrudRuntimeOutputOnlyFieldKey(
  value = "",
  {
    lookupContainerKey = DEFAULT_CRUD_LOOKUP_CONTAINER_KEY
  } = {}
) {
  const resolvedLookupContainerKey = normalizeCrudLookupContainerKey(lookupContainerKey, {
    context: "crud runtime lookup container key"
  });
  return normalizeText(value) === resolvedLookupContainerKey;
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

function resolveCrudLookupFieldEntries(resource = {}, { allowKeys = [] } = {}) {
  const source = resource && typeof resource === "object" && !Array.isArray(resource) ? resource : {};
  const entries = Object.values(buildCrudFieldContractMap(source, {
    context: "crud lookup field entries"
  }));
  const allowedKeySet = new Set(
    (Array.isArray(allowKeys) ? allowKeys : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  );

  const keys = [];
  const seenKeys = new Set();
  for (const entry of entries) {
    const key = normalizeText(entry.key);
    if (!key || seenKeys.has(key)) {
      continue;
    }
    if (allowedKeySet.size > 0 && !allowedKeySet.has(key)) {
      continue;
    }

    const relation = entry.relation;
    if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
      continue;
    }
    if (normalizeText(relation.kind).toLowerCase() !== "lookup") {
      continue;
    }

    seenKeys.add(key);
    keys.push(
      Object.freeze({
        key,
        parentRouteParamKey: normalizeText(entry.parentRouteParamKey)
      })
    );
  }

  return Object.freeze(keys);
}

function resolveCrudLookupCreateSchemaKeys(resource) {
  return Object.freeze(
    Object.keys(
      resolveCrudFieldSchemaProperties(resource?.operations?.create?.body, {
        context: "crud lookup create schema"
      })
    )
  );
}

function resolveCrudLookupFieldKeys(resource = {}, { allowKeys = [] } = {}) {
  return Object.freeze(
    resolveCrudLookupFieldEntries(resource, { allowKeys })
      .map(({ key }) => key)
  );
}

function resolveCrudParentFilterKeys(resource = {}) {
  return resolveCrudLookupFieldKeys(resource, {
    allowKeys: resolveCrudLookupCreateSchemaKeys(resource)
  });
}

function resolveCrudLookupFieldKeyFromRouteParam(resource = {}, routeParamKey = "", { allowKeys = [] } = {}) {
  const normalizedRouteParamKey = normalizeText(routeParamKey);
  if (!normalizedRouteParamKey) {
    return "";
  }

  const entries = resolveCrudLookupFieldEntries(resource, { allowKeys });
  for (const entry of entries) {
    if (entry.key === normalizedRouteParamKey) {
      return entry.key;
    }
  }

  for (const entry of entries) {
    if (entry.parentRouteParamKey === normalizedRouteParamKey) {
      return entry.key;
    }
  }

  return "";
}

export {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  expandCrudLookupFields,
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace,
  resolveCrudResourceScopeName,
  normalizeCrudLookupContainerKey,
  isCrudRuntimeOutputOnlyFieldKey,
  resolveCrudLookupContainerKey,
  resolveCrudLookupFieldKeys,
  resolveCrudParentFilterKeys,
  resolveCrudLookupFieldKeyFromRouteParam
};
