import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

/** @param {{ consoleSettingsRepository: import("../types.js").ConsoleSettingsRepository }} dependencies */
function createService({ consoleSettingsRepository }) {
  async function ensureInitialConsoleMember(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(400, "Invalid console user.", { code: "console.owner.invalidUser" });
    }

    return consoleSettingsRepository.ensureOwnerUserId(normalizedUserId, options);
  }

  async function isConsoleOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return false;
    }

    const settings = await consoleSettingsRepository.getSingleton(options);
    const ownerUserId = normalizeRecordId(settings?.ownerUserId, { fallback: null });
    return Boolean(ownerUserId) && ownerUserId === normalizedUserId;
  }

  /**
   * Refuses anyone but the console's owner; the first signed-in user to ask
   * becomes the owner.
   * @param {object | null | undefined} context The call's context: its actor, else its request's user.
   * @param {{ trx?: import("@jskit-ai/database-runtime/server/types").RuntimeKnexTransaction | null }} [options]
   */
  async function requireConsoleOwner(context, options = {}) {
    const actorUserId = normalizeRecordId(resolveActorId(context), { fallback: null });
    if (!actorUserId) {
      throw new AppError(401, "Authentication required.", { code: "console.owner.authenticationRequired" });
    }

    const ownerUserId = await ensureInitialConsoleMember(actorUserId, options);
    if (actorUserId !== ownerUserId) {
      throw new AppError(403, "Forbidden.", { code: "console.owner.forbidden" });
    }
  }

  return Object.freeze({
    ensureInitialConsoleMember,
    isConsoleOwnerUserId,
    requireConsoleOwner
  });
}

export { createService };
