import { resolveActor } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * The user an account action runs for: the input's user, when an internal
 * caller names one, else the signed-in user (kernel's resolveActor: the
 * context's actor, else the request's user).
 * @param {object} context
 * @param {unknown} [input]
 */
function resolveActionUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveActor(context);
}

export { resolveActionUser };
