import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

function createService({ consoleSettingsRepository } = {}) {
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.ensureOwnerUserId !== "function") {
    throw new Error("consoleService requires consoleSettingsRepository.ensureOwnerUserId().");
  }

  async function ensureInitialConsoleMember(userId, options = {}) {
    const normalizedUserId = parsePositiveInteger(userId);
    if (!normalizedUserId) {
      throw new AppError(400, "Invalid console user.");
    }

    return consoleSettingsRepository.ensureOwnerUserId(normalizedUserId, options);
  }

  async function requireConsoleOwner(context = {}, options = {}) {
    const actorUserId = parsePositiveInteger(context?.actor?.id);
    if (!actorUserId) {
      throw new AppError(401, "Authentication required.");
    }

    const ownerUserId = await ensureInitialConsoleMember(actorUserId, options);
    if (actorUserId !== ownerUserId) {
      throw new AppError(403, "Forbidden.");
    }
  }

  return Object.freeze({
    ensureInitialConsoleMember,
    requireConsoleOwner
  });
}

export { createService };
