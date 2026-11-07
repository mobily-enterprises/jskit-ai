import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
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

// The ways a Knex raw expression runs as a statement of its own. raw() answers a value for a scoped query, so each of
// these throws: an awaited raw expression would run its SQL with no ownership scope at all.
const STATEMENT_METHODS = Object.freeze(new Set(["then", "catch", "finally", "asCallback", "stream", "pipe"]));

/**
 * A Knex raw expression that works only as a value: in a select, a where or a write.
 * @param {string} name The resource's name.
 * @param {object} expression
 */
function valueOnly(name, expression) {
  return new Proxy(expression, {
    get(target, property, receiver) {
      if (STATEMENT_METHODS.has(property)) {
        return () => {
          throw new TypeError(`${name}.raw() is a value inside a scoped query or a write; it never runs as a statement of its own.`);
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
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

export { requireDefinedFilters, requireOwners, valueOnly, whereSelection };
