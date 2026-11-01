import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * The user an action runs for: the input's user, else the request's user, else
 * the context's actor.
 * @param {object} context
 * @param {unknown} [input]
 */
function resolveActionUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

export { resolveActionUser };
