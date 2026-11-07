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

export { requireOwners, valueOnly };
