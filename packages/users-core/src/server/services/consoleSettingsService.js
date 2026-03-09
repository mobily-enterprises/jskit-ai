import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function createValidationError(fieldErrors = {}) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function buildSettingsResponse(record = {}) {
  return {
    settings: {
      assistantSystemPromptWorkspace: String(record.assistantSystemPromptWorkspace || "")
    }
  };
}

function createService({ consoleSettingsRepository } = {}) {
  if (
    !consoleSettingsRepository ||
    typeof consoleSettingsRepository.ensureSingleton !== "function" ||
    typeof consoleSettingsRepository.updateSingleton !== "function"
  ) {
    throw new Error("consoleSettingsService requires consoleSettingsRepository.");
  }

  async function getSettings() {
    const settings = await consoleSettingsRepository.ensureSingleton({
      assistantSystemPromptWorkspace: ""
    });

    return buildSettingsResponse(settings);
  }

  async function updateSettings(input = {}) {
    const payload = normalizeObject(input);
    if (!Object.hasOwn(payload, "assistantSystemPromptWorkspace")) {
      throw createValidationError({
        assistantSystemPromptWorkspace: "assistantSystemPromptWorkspace is required."
      });
    }

    const settings = await consoleSettingsRepository.updateSingleton({
      assistantSystemPromptWorkspace: String(payload.assistantSystemPromptWorkspace || "")
    });

    return buildSettingsResponse(settings);
  }

  return Object.freeze({
    getSettings,
    updateSettings
  });
}

export { createService };
