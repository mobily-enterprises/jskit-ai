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

const emptyInputValidator = Object.freeze({
  schema: createSchema({}),
  mode: "replace"
});

export {
  resolveActor,
  resolveActorId,
  resolveRequest,
  emptyInputValidator
};
