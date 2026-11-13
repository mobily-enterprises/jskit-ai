import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

/** The assistant of an application that supplies no `assistant.turnGuard`: every turn runs. */
const NO_TURN_GUARD = Object.freeze({
  admit() {
    return { allowed: true };
  }
});

/** A returned value as the error that refuses it shows it. */
function describeDecision(value) {
  try {
    return (JSON.stringify(value) ?? typeof value).slice(0, 200);
  } catch {
    return typeof value;
  }
}

/**
 * The application's turn guard, held to its contract. Each new turn of the database-backed
 * assistant asks it once, before anything is saved or sent: it lets the turn run, answers it
 * with a fixed reply instead of the model, or refuses it with an `AppError`, which reaches the
 * person as it is. Any other answer is a programming error, logged and thrown.
 * @param {object} dependencies
 * @param {import("../types.js").AssistantTurnGuard} dependencies.turnGuard
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 */
function createTurnAdmission({ turnGuard, logger }) {
  // readable-check: allow method-probe - input validation: an application hands the assistant its turn guard
  if (typeof turnGuard?.admit !== "function") {
    throw new TypeError("assistant.turnGuard requires admit({ targetSurfaceId, context, input, conversationId, messageId }).");
  }

  /**
   * The application's fixed reply to a new turn, or null when the turn runs as usual.
   * @param {{ targetSurfaceId: string, context: object, input: string, conversationId: string | null, messageId: string }} request
   * @returns {Promise<string | null>}
   */
  async function fixedReply(request) {
    const decision = await turnGuard.admit(request);
    if (isRecord(decision) && Object.keys(decision).length === 1) {
      if (decision.allowed === true) return null;
      if (typeof decision.reply === "string" && decision.reply.trim()) return decision.reply.trim();
    }
    const message = `assistant.turnGuard.admit() returned ${describeDecision(decision)}; it must return { allowed: true } or { reply } with the reply's text, or throw an AppError to refuse the turn.`;
    logger.error({ surfaceId: request.targetSurfaceId, messageId: request.messageId }, message);
    throw new TypeError(message);
  }

  return Object.freeze({
    fixedReply
  });
}

export { NO_TURN_GUARD, createTurnAdmission };
