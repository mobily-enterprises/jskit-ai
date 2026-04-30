import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function createService({ consoleSettingsRepository } = {}) {
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.ensureOwnerUserId !== "function") {
    throw new Error("consoleService requires consoleSettingsRepository.ensureOwnerUserId().");
  }
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.getSingleton !== "function") {
    throw new Error("consoleService requires consoleSettingsRepository.getSingleton().");
  }

  async function ensureInitialConsoleMember(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(400, "Invalid console user.");
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

  async function requireConsoleOwner(context = {}, options = {}) {
    const actorUserId = normalizeRecordId(context?.actor?.id, { fallback: null });
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
    isConsoleOwnerUserId,
    requireConsoleOwner
  });
}

export { createService };
