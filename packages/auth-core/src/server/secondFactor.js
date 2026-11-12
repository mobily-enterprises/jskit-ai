import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { SECOND_FACTOR_REQUIRED } from "../shared/authSecondFactor.js";

/**
 * Whether a session's second factor meets a requirement: true asks for one
 * proved at any time in the session, `{ maxAgeSeconds }` for one proved within
 * that many seconds of now.
 * @param {string} secondFactorAt When the session last proved its second factor, as ISO text, or "" when it has not.
 * @param {true | { maxAgeSeconds: number }} requirement
 * @param {number} now
 */
function isSecondFactorMet(secondFactorAt, requirement, now) {
  const provedAt = Date.parse(secondFactorAt || "");
  if (!Number.isFinite(provedAt)) {
    return false;
  }
  return requirement === true || now - provedAt <= requirement.maxAgeSeconds * 1000;
}

/**
 * The refusal's params: the age a proof may have, when the requirement names one.
 * @param {true | { maxAgeSeconds: number }} requirement
 */
function secondFactorRequiredParams(requirement) {
  return requirement === true ? {} : { maxAgeSeconds: requirement.maxAgeSeconds };
}

/**
 * Refuses a signed-in request whose session has not proved its second factor
 * as the requirement asks, with 403 `auth.secondFactor.required`, the refusal
 * a route's `secondFactor` option gives. For an action whose requirement
 * depends on more than its route, such as the actor's role. The auth policy
 * sets `request.secondFactorAt` on every route that signs its caller in; a
 * call without a request, as from the server's own code, has no session to
 * prove it and is refused.
 * @param {{ secondFactorAt?: string } | null} request The action's `resolveRequest(context)`.
 * @param {true | { maxAgeSeconds: number }} requirement
 */
function requireSecondFactor(request, requirement) {
  const valid = requirement === true || (Number.isInteger(requirement?.maxAgeSeconds) && requirement.maxAgeSeconds > 0);
  if (!valid) {
    throw new TypeError("requireSecondFactor() takes true or { maxAgeSeconds } with a positive integer.");
  }
  if (!isSecondFactorMet(request ? request.secondFactorAt : "", requirement, Date.now())) {
    throw new AppError(403, SECOND_FACTOR_REQUIRED.message, {
      code: SECOND_FACTOR_REQUIRED.code,
      params: secondFactorRequiredParams(requirement)
    });
  }
}

export {
  isSecondFactorMet,
  requireSecondFactor,
  secondFactorRequiredParams
};
