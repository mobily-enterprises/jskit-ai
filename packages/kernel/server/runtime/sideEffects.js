import { isProductionEnv } from "./runtimeMode.js";
import { SIDE_EFFECTS_ENV_KEY, SIDE_EFFECTS_LIVE, resolveSideEffectsMode } from "../../shared/support/sideEffects.js";

/**
 * Writes one side effect a test copy simulated instead of performing, so the
 * person testing it can follow what would have gone out (an email's recipient,
 * subject and link, a message's text). Every JSKIT package that would have sent
 * something logs through this one line shape.
 * @param {import("../types.js").RuntimeLogger} logger
 * @param {object} effect
 * @param {string} effect.kind What would have gone out, such as "email", "sms" or "connector operation".
 * @param {string} effect.summary One plain phrase naming it, such as "password reset email to ada@example.com".
 * @param {Record<string, unknown>} [effect.details] What a tester needs to act on it, such as the link it carried.
 */
function logSimulatedSideEffect(logger, { kind, summary, details = {} }) {
  logger.info(
    { sideEffects: "simulate", kind, ...details },
    `Test copy: ${summary} was simulated, not sent (${SIDE_EFFECTS_ENV_KEY} is not ${SIDE_EFFECTS_LIVE}).`
  );
}

/**
 * Says once, as the application starts, whether it acts for real. A production
 * server that simulates warns, so an application that used to send email does
 * not stop sending without a word.
 * @param {import("../types.js").RuntimeLogger} logger
 * @param {import("../types.js").RuntimeEnv} env
 */
function logSideEffectsMode(logger, env) {
  if (resolveSideEffectsMode(env) === SIDE_EFFECTS_LIVE) {
    logger.info({ sideEffects: SIDE_EFFECTS_LIVE }, "Side effects are live: email, messages and payments are sent for real.");
    return;
  }
  const message = `Side effects are simulated: this is a test copy. Email, SMS, push notifications, payments and webhooks ` +
    `are written to the log instead of being sent, and pages show a "Test copy" banner. Set ${SIDE_EFFECTS_ENV_KEY}=` +
    `${SIDE_EFFECTS_LIVE} to act for real.`;
  if (isProductionEnv(env)) {
    logger.warn({ sideEffects: "simulate" }, message);
  } else {
    logger.info({ sideEffects: "simulate" }, message);
  }
}

export { logSideEffectsMode, logSimulatedSideEffect };
