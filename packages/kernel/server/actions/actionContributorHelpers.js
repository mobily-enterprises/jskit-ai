import { createSchema } from "json-rest-schema";
import { normalizeOpaqueId } from "../../shared/support/normalize.js";

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

/**
 * The signed-in user an action or route runs for: the context's actor, else
 * the request's user; null when no one is signed in. Auth's action context
 * contributor sets the actor from the request's user, so in an action's
 * execute both are the same user; a route visibility resolver runs before
 * that contributor, so it reads the request's.
 * @param {object | null} [context]
 * @param {object | null} [request] The request, when the caller holds it apart from the context.
 */
function resolveActor(context, request) {
  const source = request || resolveRequest(context);
  return context?.actor || source?.user || null;
}

/**
 * The id of the signed-in user an action or route runs for (see resolveActor), or null.
 * @param {object | null} [context]
 * @param {object | null} [request]
 * @returns {string | null}
 */
function resolveActorId(context, request) {
  return normalizeOpaqueId(resolveActor(context, request)?.id);
}

/**
 * The id of the user a write is made for, for audit fields such as createdBy: the signed-in user (see
 * resolveActorId), else the user background work acts for (`context.onBehalfOf.id`, which a job context derived
 * for one person carries). It never decides access: work done for someone is not signed in as them, so
 * resolveActor, resolveActorId and every authentication check see no one.
 * @param {object | null} [context]
 * @param {object | null} [request]
 * @returns {string | null}
 */
function resolveAuditActorId(context, request) {
  return resolveActorId(context, request) ?? normalizeOpaqueId(context?.onBehalfOf?.id);
}

const emptyInputValidator = Object.freeze({
  schema: createSchema({}),
  mode: "replace"
});

export {
  resolveActor,
  resolveActorId,
  resolveAuditActorId,
  resolveRequest,
  emptyInputValidator
};
