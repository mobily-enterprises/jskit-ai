import { createSystemContext as createJsonRestSystemContext, isSystemContext } from "json-rest-api";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// Module-private: only jobContext() marks a context as background work's, so a
// request cannot claim it. Object spread keeps the marker, as json-rest-api's
// own system marker.
const JOB_CONTEXT = Symbol("jskit.resources.jobContext");

/**
 * The context one json-rest-api call works in: a copy of the caller's, with its
 * visibility context and scope values copied too, since json-rest-api writes an
 * operation's working state into the context it is given. A system context
 * stays one, because spread keeps its marker.
 * @param {object | null | undefined} [context]
 */
function createJsonRestContext(context = null) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const nextContext = {
    ...context
  };

  if (context.visibilityContext && typeof context.visibilityContext === "object" && !Array.isArray(context.visibilityContext)) {
    nextContext.visibilityContext = {
      ...context.visibilityContext
    };
  }

  if (context.scopeValues && typeof context.scopeValues === "object" && !Array.isArray(context.scopeValues)) {
    nextContext.scopeValues = {
      ...context.scopeValues
    };
  }

  return nextContext;
}

/**
 * Whether a context belongs to background work: a system context, or a
 * workspace or user context a system context derived. Request row limits
 * apply to every other context.
 * @param {unknown} context
 */
function isJobContext(context) {
  return isSystemContext(context) || Boolean(context && typeof context === "object" && context[JOB_CONTEXT]);
}

/**
 * @param {string} reason
 * @param {Record<string, unknown>} scopeValues
 */
function jobContext(reason, scopeValues) {
  return Object.freeze({
    scopeValues: Object.freeze(scopeValues),
    jobReason: reason,
    [JOB_CONTEXT]: true
  });
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function requireScopeId(value, label) {
  const id = normalizeRecordId(value, { fallback: null });
  if (!id) {
    throw new TypeError(`${label} needs the id of the ${label === "forWorkspace" ? "workspace" : "user"} to work on.`);
  }
  return id;
}

/**
 * The context of work across every workspace and user, for a feature that
 * declares `systemScope`. Ownership predicates are skipped for it, row
 * policies receive `system: true`, and creates name their ownership values.
 * `forWorkspace(id)` and `forUser(id)` derive ordinary contexts scoped to one
 * workspace or user, so the work for each is scoped as usual (and, as
 * background work, free of request row limits).
 * @param {{ feature: string, systemScope: string, reason: string }} declaration
 */
function createSystemContext({ feature, systemScope, reason }) {
  const normalizedReason = normalizeText(reason);
  if (!normalizedReason) {
    throw new TypeError(`Feature "${feature}" needs the reason its work reads or writes every workspace's rows.`);
  }
  const description = `${feature}: ${normalizedReason}`;

  /** @param {unknown} workspaceId */
  function forWorkspace(workspaceId) {
    return jobContext(description, { workspaceId: requireScopeId(workspaceId, "forWorkspace") });
  }

  /** @param {unknown} userId */
  function forUser(userId) {
    return jobContext(description, { userId: requireScopeId(userId, "forUser") });
  }

  return Object.freeze(createJsonRestSystemContext(description, {
    feature,
    systemScope,
    reason: normalizedReason,
    forWorkspace,
    forUser
  }));
}

export { createJsonRestContext, createSystemContext, isJobContext, isSystemContext };
