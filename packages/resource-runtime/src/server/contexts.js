import { createSystemContext as createJsonRestSystemContext, isSystemContext } from "json-rest-api";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
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
 * Who a call runs for, as its row policy sees it: background work across every workspace and user ("system"),
 * background work a system context derived for one workspace or user ("job"), each with its reason; a request by a
 * signed-in user ("user", with the user's id); or a request by no one ("anonymous"). A derived job context names a
 * user only as the person it acts for (`actorId`, when it was given one), never as a signed-in user, so a policy
 * that keys on the actor tells it from an anonymous request by its kind.
 * @param {unknown} context
 * @returns {Readonly<{ kind: "system", reason: string } | { kind: "job", reason: string, actorId?: string } | { kind: "user", userId: string } | { kind: "anonymous" }>}
 */
function callerOf(context) {
  if (isSystemContext(context)) {
    return Object.freeze({
      kind: "system",
      reason: context.systemReason
    });
  }
  if (context && typeof context === "object" && context[JOB_CONTEXT]) {
    return Object.freeze({
      kind: "job",
      reason: context.jobReason,
      ...(context.onBehalfOf ? { actorId: context.onBehalfOf.id } : {})
    });
  }
  const userId = resolveActorId(context);
  return Object.freeze(userId ? { kind: "user", userId } : { kind: "anonymous" });
}

/**
 * The event scope of work on one workspace, one user or one person in a workspace, as a request there carries it, so
 * an event the work publishes reaches that workspace's or that user's audience, never everyone.
 * @param {{ workspaceId?: string, userId?: string }} scopeValues
 */
function eventScopeOf({ workspaceId, userId }) {
  if (workspaceId && userId) {
    return Object.freeze({ kind: "workspace_user", id: workspaceId, scopeId: workspaceId, userId });
  }
  return Object.freeze(workspaceId ? { kind: "workspace", id: workspaceId } : { kind: "user", id: userId });
}

/**
 * @param {string} reason
 * @param {Record<string, unknown>} scopeValues
 * @param {{ actorId?: unknown }} options The person the work acts for, if any: `onBehalfOf.id`, for audit fields only.
 * @param {string} label The deriving method, such as "forWorkspace".
 */
function jobContext(reason, scopeValues, options, label) {
  if (options !== undefined && (!options || typeof options !== "object" || Object.keys(options).some((key) => key !== "actorId"))) {
    throw new TypeError(`${label} takes { actorId } as its last argument: the user the work acts for.`);
  }
  const actorId = options?.actorId === undefined ? null : requireScopeId(options.actorId, label, "user it acts for");
  return Object.freeze({
    scopeValues: Object.freeze(scopeValues),
    scope: eventScopeOf(scopeValues),
    jobReason: reason,
    ...(actorId ? { onBehalfOf: Object.freeze({ id: actorId }) } : {}),
    [JOB_CONTEXT]: true
  });
}

/**
 * @param {unknown} value
 * @param {string} label The deriving method, such as "forWorkspace".
 * @param {"workspace" | "user" | "user it acts for"} subject What the id names.
 */
function requireScopeId(value, label, subject) {
  const id = normalizeRecordId(value, { fallback: null });
  if (!id) {
    throw new TypeError(`${label} needs the id of the ${subject} to work on.`);
  }
  return id;
}

/**
 * The context of work across every workspace and user, for a feature that
 * declares `systemScope`. Ownership predicates are skipped for it, row
 * policies receive `system: true` and `caller.kind` "system" (a derived
 * context's `caller.kind` is "job"), and creates name their ownership values.
 * `forWorkspace(id)`, `forUser(id)` and `forWorkspaceUser(workspaceId, userId)`
 * derive ordinary contexts scoped to one workspace, one user, or one user in
 * one workspace, so the work for each is scoped as usual (and, as background
 * work, free of request row limits). Each takes `{ actorId }` last, for work
 * done for one person (a request a job carries out): the context's
 * `onBehalfOf`, which audit fields read with `resolveAuditActorId(context)`,
 * and the row policy's `caller.actorId`. It names who the work is for, never
 * which rows it reaches, and it signs no one in: `resolveActorId` and every
 * authentication check still see no one.
 * @param {{ feature: string, systemScope: string, reason: string }} declaration
 */
function createSystemContext({ feature, systemScope, reason }) {
  const normalizedReason = normalizeText(reason);
  if (!normalizedReason) {
    throw new TypeError(`Feature "${feature}" needs the reason its work reads or writes every workspace's rows.`);
  }
  const description = `${feature}: ${normalizedReason}`;

  /**
   * @param {unknown} workspaceId
   * @param {{ actorId?: unknown }} [options]
   */
  function forWorkspace(workspaceId, options) {
    return jobContext(description, { workspaceId: requireScopeId(workspaceId, "forWorkspace", "workspace") }, options, "forWorkspace");
  }

  /**
   * @param {unknown} userId
   * @param {{ actorId?: unknown }} [options]
   */
  function forUser(userId, options) {
    return jobContext(description, { userId: requireScopeId(userId, "forUser", "user") }, options, "forUser");
  }

  /**
   * One user's context inside one workspace: a `workspace_user` table reads
   * that user's rows in that workspace, a `workspace` table the workspace's
   * and a `user` table the user's.
   * @param {unknown} workspaceId
   * @param {unknown} userId
   * @param {{ actorId?: unknown }} [options]
   */
  function forWorkspaceUser(workspaceId, userId, options) {
    return jobContext(description, {
      workspaceId: requireScopeId(workspaceId, "forWorkspaceUser", "workspace"),
      userId: requireScopeId(userId, "forWorkspaceUser", "user")
    }, options, "forWorkspaceUser");
  }

  return Object.freeze(createJsonRestSystemContext(description, {
    feature,
    systemScope,
    reason: normalizedReason,
    forWorkspace,
    forUser,
    forWorkspaceUser
  }));
}

export { callerOf, createJsonRestContext, createSystemContext, isJobContext, isSystemContext };
