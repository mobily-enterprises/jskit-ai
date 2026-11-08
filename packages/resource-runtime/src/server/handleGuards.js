import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { passedOn } from "./callOptions.js";
import { isSystemContext } from "./contexts.js";
import { MissingScopeError } from "./errors.js";
import { resolveUserScopeValue, resolveWorkspaceScopeValue } from "./resourceHost.js";

// The checks that keep a handle's calls inside their scope: a call never reaches rows beyond
// the caller's because a context, a filter value or an expression was missing or misused.

// The owners a context must name for each ownership. A context naming none of them would match the rows whose owner is
// null; a workspace_or_shared table reads exactly those shared rows without a workspace, and refuses writes there.
const REQUIRED_OWNERS = Object.freeze({
  public: Object.freeze([]),
  workspace: Object.freeze(["workspace"]),
  user: Object.freeze(["user"]),
  workspace_user: Object.freeze(["workspace", "user"]),
  workspace_or_shared: Object.freeze([])
});
const OWNER_RESOLVERS = Object.freeze({ workspace: resolveWorkspaceScopeValue, user: resolveUserScopeValue });

/**
 * Refuses a context, other than a system context, that names no owner the table's ownership needs.
 * @param {string} name The resource's name.
 * @param {string} ownership
 * @param {object | null | undefined} context
 */
function requireOwners(name, ownership, context) {
  if (isSystemContext(context)) {
    return;
  }
  const missing = REQUIRED_OWNERS[ownership].find((owner) => !OWNER_RESOLVERS[owner](context));
  if (missing) {
    throw new MissingScopeError(name, missing);
  }
}

/**
 * Refuses a filter whose value is undefined, at any depth. json-rest-api drops such a filter, so a caller's missing
 * value would widen the selection to every row it owns instead of none.
 * @param {string} name
 * @param {string} caller
 * @param {unknown} filters
 * @param {string} [path]
 */
function requireDefinedFilters(name, caller, filters, path = "filters") {
  if (!isRecord(filters)) {
    return filters;
  }
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) {
      throw new TypeError(`${name}.${caller}() ${path}.${key} is undefined: pass its value, or leave the filter out.`);
    }
    requireDefinedFilters(name, caller, value, `${path}.${key}`);
  }
  return filters;
}


/**
 * A filtered write's selection: its filters, or every owned row when they are empty and `all: true` says so. An
 * undefined filter value is refused, so a missing value never counts as a filter yet selects every row.
 * @param {string} name The resource's name.
 * @param {string} operation
 * @param {unknown} filters
 * @param {{ all?: boolean }} options
 */
function whereSelection(name, operation, filters, options) {
  if (!isRecord(filters)) {
    throw new TypeError(`${name}.${operation}() takes filters as an object.`);
  }
  if (options.missing !== undefined) {
    throw new TypeError(`${name}.${operation}() changes the rows the filters select when it runs, so it takes no missing.`);
  }
  requireDefinedFilters(name, operation, filters);
  if (Object.keys(filters).length > 0) {
    if (options.all !== undefined) {
      throw new TypeError(`${name}.${operation}() takes filters or all: true, not both.`);
    }
    return { filters };
  }
  if (options.all !== true) {
    throw new TypeError(`${name}.${operation}() with empty filters changes every row the caller owns; pass all: true to mean it.`);
  }
  return { all: true };
}

/**
 * An upsert matches rows by its conflict keys alone, so its rows carry no id, which could name another owner's
 * record, unless the id is the one key: json-rest-api allows that only on a table with no owners and no row policy.
 * @param {string} name
 * @param {unknown[]} rows
 * @param {{ keys?: unknown }} onConflict
 * @param {string | undefined} idProperty
 */
function requireUpsertRows(name, rows, onConflict, idProperty) {
  const keys = Array.isArray(onConflict.keys) ? onConflict.keys : [];
  const byId = keys.length === 1 && (keys[0] === "id" || keys[0] === idProperty);
  if (!byId && rows.some((row) => isRecord(row) && Object.hasOwn(row, "id"))) {
    throw new TypeError(
      `${name}.createMany() with onConflict takes rows without an id; the conflict keys find the existing rows. ` +
        "Only onConflict: { keys: [\"id\"] }, on a table with no owners, matches rows by their id."
    );
  }
}

// The keys of a call's options, which get() takes third, after its params.
const OPTION_KEYS = Object.freeze(["context", "trx", "format", "missing", "returning"]);

/**
 * get(), patch(), delete() and lock() throw json-rest-api's not-found error for
 * a missing or hidden row, or answer null with `missing: "skip"`.
 * @param {string} name
 * @param {string} caller
 * @param {unknown} [missing]
 * @returns {"throw" | "skip"}
 */
function missingOf(name, caller, missing = "throw") {
  if (missing !== "throw" && missing !== "skip") {
    throw new TypeError(`${name}.${caller}() missing is "throw" (the default) or "skip". Received: ${JSON.stringify(missing)}`);
  }
  return missing;
}

/**
 * Refuses get(id, options): get takes its options third, after its params.
 * @param {string} name
 * @param {unknown} params
 */
function requireReadParams(name, params) {
  if (isRecord(params) && OPTION_KEYS.some((key) => Object.hasOwn(params, key))) {
    throw new TypeError(`${name}.get() takes (id, params, options), and options go third: get(id, {}, options).`);
  }
}

/**
 * Refuses a write condition that the options name with no value (`{ lockVersion: undefined }`, `{ onlyIf: undefined }`,
 * often a field read under the wrong name): run without it, the write would drop the condition it was meant to carry,
 * and a patch with no changes would only read. A call without the condition leaves the key out.
 * @param {string} name The resource's name.
 * @param {string} method The handle method, such as "patch".
 * @param {Record<string, unknown>} options
 * @param {string[]} keys The condition keys the method takes.
 */
function requireConditionValues(name, method, options, keys) {
  for (const key of keys) {
    if (Object.hasOwn(options, key) && options[key] === undefined) {
      throw new TypeError(`${name}.${method}() options.${key} is undefined. Give it a value, or leave the key out for a ${method} without it.`);
    }
  }
}

/**
 * Refuses lockVersion or onlyIf, named at all, on a write that cannot compare them: run without them, the write would
 * change or delete the rows whatever they hold.
 * @param {string} name The resource's name.
 * @param {string} method The handle method, such as "delete".
 * @param {Record<string, unknown>} options
 * @param {string[]} keys The conditions the method cannot compare.
 * @param {string} instead What the caller does instead.
 */
function refuseConditions(name, method, options, keys, instead) {
  const named = keys.filter((key) => Object.hasOwn(options, key));
  if (named.length > 0) {
    throw new TypeError(`${name}.${method}() cannot compare ${named.join(" or ")}, so it refuses rather than write without them. ${instead}`);
  }
}

/**
 * Refuses a patch's lockVersion or onlyIf named with no value (see requireConditionValues); a lockVersion without a
 * lockVersionField, or one that is not a version, or changes that write the version the patch advances itself; and an
 * onlyIf that is not an object of field values.
 * @param {string} name
 * @param {string} lockVersionField
 * @param {Record<string, unknown>} attributes
 * @param {{ lockVersion?: unknown, onlyIf?: unknown }} options The patch's options.
 */
function requirePatchConditions(name, lockVersionField, attributes, options) {
  requireConditionValues(name, "patch", options, ["lockVersion", "onlyIf"]);
  const { lockVersion, onlyIf } = options;
  if (lockVersion !== undefined) {
    if (!lockVersionField) {
      throw new TypeError(`${name}.patch() lockVersion needs the resource to name its lockVersionField.`);
    }
    if (!Number.isSafeInteger(lockVersion) || Number(lockVersion) < 0) {
      throw new TypeError(`${name}.patch() lockVersion must be a non-negative integer. Received: ${lockVersion}`);
    }
    if (Object.hasOwn(attributes, lockVersionField)) {
      throw new TypeError(`${name}.patch() advances ${lockVersionField} itself, so the attributes must leave it out.`);
    }
  }
  if (onlyIf !== undefined && !isRecord(onlyIf)) {
    throw new TypeError(`${name}.patch() onlyIf must be an object of field values.`);
  }
}

/**
 * The answer format a handle call asks for: "jsonapi" (the CRUD service's documents) or, by default, "plain" (records).
 * @param {string} name The resource's name.
 * @param {{ format?: string }} options
 */
function formatOf(name, options) {
  if (options.format !== undefined && options.format !== "jsonapi") {
    throw new TypeError(`${name} options.format is "jsonapi" (the CRUD service's documents) or absent (records).`);
  }
  return options.format === "jsonapi" ? "jsonapi" : "plain";
}

/**
 * Whether the filters give an empty list to a filter that matches one of a list (the id filter, or any filter whose
 * search entry says `filterOperator: "in"`): such a read matches no row, so the handle answers it without a statement.
 * @param {unknown} filters
 * @param {{ searchSchemaStructure?: Record<string, { filterOperator?: string }> }} schemaInfo The table's compiled
 *   json-rest-api schema (`vars.schemaInfo`).
 */
function matchesNoRow(filters, schemaInfo) {
  if (!isRecord(filters)) {
    return false;
  }
  const search = schemaInfo.searchSchemaStructure || {};
  return Object.entries(filters).some(([key, value]) => Array.isArray(value) && value.length === 0 && search[key]?.filterOperator === "in");
}

export {
  formatOf, matchesNoRow, missingOf, refuseConditions, requireConditionValues, requireDefinedFilters, requireOwners, requirePatchConditions,
  requireReadParams, requireUpsertRows, passedOn, whereSelection
};
