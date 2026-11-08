import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toCamelCase } from "@jskit-ai/kernel/shared/support/stringCase";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

// Who owns a row. `workspace_or_shared` rows are a workspace's own, or shared
// with every workspace when their owner is null.
const OWNERSHIP_KINDS = Object.freeze([
  "public",
  "workspace",
  "user",
  "workspace_user",
  "workspace_or_shared"
]);

const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
const LOOKUP_FORM_CONTROL = "autocomplete";

// Keys a table resource never takes, and where each belongs. The CRUD keys are
// the HTTP surface's; the server-only keys must not ship to the client.
const MISPLACED_KEYS = Object.freeze({
  namespace: "the CRUD or API contract (defineCrudContract, defineApiContract)",
  apiAccess: "the CRUD contract (defineCrudContract)",
  crudOperations: "the CRUD contract's operations (defineCrudContract)",
  crud: "the CRUD contract (defineCrudContract)",
  operations: "the CRUD or API contract (defineCrudContract, defineApiContract)",
  messages: "the CRUD or API contract (defineCrudContract, defineApiContract)",
  contract: "the CRUD contract (defineCrudContract); a table resource's response exclusions are its defaultExclude",
  autofilter: "ownership",
  rowPolicy: "the owner feature's owns entry, on the server",
  hooks: "the owner feature's owns entry, on the server"
});

const tableResources = new WeakSet();

/**
 * The resource name a namespace stands for: `processing-lots` and
 * `/processing-lots` are `processingLots`. A lookup field names the namespace
 * it looks up, and belongs to the resource of that name.
 * @param {unknown} namespace
 * @returns {string}
 */
function resourceNameFromNamespace(namespace = "") {
  const pathname = normalizePathname(normalizeText(namespace));
  if (pathname === "/") {
    return "";
  }
  return toCamelCase(pathname.slice(1).replace(/\//gu, "-"));
}

/**
 * A schema field written with `lookup: "<namespace>"`, expanded where `lookup`
 * stood into a lookup `relation` on that namespace's `id`, `belongsTo` its
 * resource, `as` the field key without its `Id` suffix, and an autocomplete
 * `ui.formControl`. Keys the field also writes win; inside `relation` and `ui`
 * they are merged over the filled-in ones.
 * @param {string} fieldKey
 * @param {Record<string, any>} fieldDefinition
 */
function expandLookupField(fieldKey, fieldDefinition) {
  const namespace = normalizePathname(normalizeText(fieldDefinition.lookup)).slice(1);
  if (!namespace) {
    throw new TypeError(`defineTableResource schema.${fieldKey}.lookup must name the namespace it looks up.`);
  }
  const relationshipName = fieldDefinition.as ?? (/.Id$/u.test(fieldKey) ? fieldKey.slice(0, -2) : "");
  if (!relationshipName) {
    throw new TypeError(`defineTableResource schema.${fieldKey} has no "Id" suffix, so its lookup must name its relationship with as.`);
  }
  const filled = {
    relation: { kind: "lookup", namespace, valueKey: "id", ...normalizeObject(fieldDefinition.relation) },
    belongsTo: fieldDefinition.belongsTo ?? resourceNameFromNamespace(namespace),
    as: relationshipName,
    ui: { formControl: LOOKUP_FORM_CONTROL, ...normalizeObject(fieldDefinition.ui) }
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
 * The schema with each field checked and each lookup shorthand expanded. A
 * field's CRUD operations belong to the CRUD contract's `fields`.
 * @param {unknown} schema
 */
function normalizeTableSchema(schema) {
  if (!isRecord(schema) || Object.keys(schema).length < 1) {
    throw new TypeError("defineTableResource requires schema, an object with at least one field.");
  }
  return Object.fromEntries(Object.entries(schema).map(([fieldKey, fieldDefinition]) => {
    if (!isRecord(fieldDefinition)) {
      throw new TypeError(`defineTableResource schema.${fieldKey} must be an object.`);
    }
    if (Object.hasOwn(fieldDefinition, "default")) {
      throw new TypeError(`defineTableResource schema.${fieldKey}.default would be ignored: a field's default value is defaultTo.`);
    }
    if (fieldDefinition.required === true && fieldDefinition.defaultTo !== undefined) {
      throw new TypeError(
        `defineTableResource schema.${fieldKey} is required and has defaultTo: a field with defaultTo is not required. ` +
          "A create is checked for required fields before defaults apply, so one without the field would fail REQUIRED."
      );
    }
    if (Object.hasOwn(fieldDefinition, "operations")) {
      throw new TypeError(
        `defineTableResource schema.${fieldKey}.operations belongs to the CRUD contract: ` +
          `defineCrudContract(resource, { namespace, fields: { ${fieldKey}: ... } }).`
      );
    }
    return [fieldKey, typeof fieldDefinition.lookup === "string" ? expandLookupField(fieldKey, fieldDefinition) : fieldDefinition];
  }));
}

function requireText(value, label) {
  const text = normalizeText(value);
  if (!text) {
    throw new TypeError(`defineTableResource requires ${label}.`);
  }
  return text;
}

// Ownership is always stated, so a table is never public by omission: a public table says `ownership: "public"`.
function requireOwnership(value) {
  const ownership = normalizeText(value);
  if (!OWNERSHIP_KINDS.includes(ownership)) {
    throw new TypeError(
      `defineTableResource requires ownership, one of: ${OWNERSHIP_KINDS.join(", ")}. Received: ${JSON.stringify(value)}.`
    );
  }
  return ownership;
}

/**
 * `lockVersionField` names the integer schema field a patch with `lockVersion`
 * checks and advances.
 * @param {unknown} lockVersionField
 * @param {Record<string, any>} schema
 */
function requireLockVersionField(lockVersionField, schema) {
  if (lockVersionField === undefined) {
    return;
  }
  if (typeof lockVersionField !== "string" || schema[lockVersionField]?.type !== "integer") {
    throw new TypeError(
      `defineTableResource lockVersionField must name an integer schema field. Received: ${JSON.stringify(lockVersionField)}.`
    );
  }
}

/**
 * The one description of one table: its name, its fields and the columns they
 * map to, who owns each row, and how it is searched and sorted. It is shared
 * with the client. Its server-only row policy and write hooks are given where
 * its owner feature lists it in `owns`, and its optional HTTP surface by
 * defineCrudContract.
 * @param {Record<string, any>} definition
 * @param {string} definition.name The resource's name, unique in the application.
 * @param {string} definition.tableName The table, unique in the application.
 * @param {string} definition.ownership One of OWNERSHIP_KINDS, always stated.
 * @param {Record<string, any>} definition.schema The fields.
 */
function defineTableResource(definition) {
  if (!isRecord(definition)) {
    throw new TypeError("defineTableResource requires a definition object.");
  }
  for (const [key, place] of Object.entries(MISPLACED_KEYS)) {
    if (Object.hasOwn(definition, key)) {
      throw new TypeError(`defineTableResource does not take ${key}: it belongs to ${place}.`);
    }
  }
  const name = requireText(definition.name, "name");
  if (!RESOURCE_NAME.test(name)) {
    throw new TypeError(`defineTableResource name must start with a letter and hold only letters, digits and _. Received: ${JSON.stringify(name)}.`);
  }
  const schema = normalizeTableSchema(definition.schema);
  requireLockVersionField(definition.lockVersionField, schema);
  const resource = deepFreeze({
    ...definition,
    name,
    tableName: requireText(definition.tableName, "tableName"),
    ownership: requireOwnership(definition.ownership),
    schema
  });
  tableResources.add(resource);
  return resource;
}

// The record timestamps a table keeps when its schema stores them as date-times. The handle stamps them, createdAt
// when a record is created and updatedAt on every write, replacing what any other caller sends: only a system
// context sets its own. A CRUD contract offers them as output only.
const RECORD_TIMESTAMPS = Object.freeze(["createdAt", "updatedAt"]);

/**
 * Which of `names` a table schema stores as date-times (not computed in the query).
 * @param {Record<string, any>} schema
 * @param {readonly string[]} [names]
 */
function storedTimestamps(schema, names = RECORD_TIMESTAMPS) {
  return names.filter((name) => {
    const field = schema[name];
    return field?.type === "dateTime" && field.virtual !== true && field.storage?.virtual !== true && !field.storage?.queryProjection;
  });
}

/**
 * Whether a value is a table resource defineTableResource returned.
 * @param {unknown} value
 */
function isTableResource(value) {
  return isRecord(value) && tableResources.has(value);
}

export {
  OWNERSHIP_KINDS,
  defineTableResource,
  RECORD_TIMESTAMPS,
  isTableResource,
  resourceNameFromNamespace,
  storedTimestamps
};
