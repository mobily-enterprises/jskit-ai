const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildValidationError(createValidationError, fieldName, message) {
  return createValidationError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        [fieldName]: message
      }
    }
  });
}

function normalizeDenyUserIds(rawUserIds) {
  if (!Array.isArray(rawUserIds)) {
    return {
      value: null,
      valid: false
    };
  }

  const normalized = [];
  for (const rawUserId of rawUserIds) {
    const numericUserId = Number(rawUserId);
    if (!Number.isInteger(numericUserId) || numericUserId < 1) {
      return {
        value: null,
        valid: false
      };
    }

    normalized.push(numericUserId);
  }

  return {
    value: Array.from(new Set(normalized)),
    valid: true
  };
}

function createWorkspaceSettingsPatchPolicy({
  createValidationError,
  normalizeEmail,
  isWorkspaceColor,
  transcriptModeValues,
  assistantSystemPromptMaxLength
} = {}) {
  const createError =
    typeof createValidationError === "function"
      ? createValidationError
      : (status, message, options = {}) => {
          const error = new Error(String(message || "Validation failed."));
          error.status = Number(status) || 500;
          error.statusCode = error.status;
          error.details = options.details;
          return error;
        };
  const normalizeEmailValue =
    typeof normalizeEmail === "function"
      ? normalizeEmail
      : (value) =>
          String(value || "")
            .trim()
            .toLowerCase();
  const isColor = typeof isWorkspaceColor === "function" ? isWorkspaceColor : () => false;
  const allowedTranscriptModes = Array.isArray(transcriptModeValues) ? [...transcriptModeValues] : [];
  const maxPromptLength = Number(assistantSystemPromptMaxLength) || 10000;

  function normalizeWorkspaceAvatarUrl(value) {
    if (value == null) {
      return "";
    }

    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "";
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw buildValidationError(createError, "avatarUrl", "Workspace avatar URL must be a valid absolute URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw buildValidationError(createError, "avatarUrl", "Workspace avatar URL must start with http:// or https://.");
    }

    return parsed.toString();
  }

  function normalizeWorkspaceColorValue(value) {
    const normalized = String(value || "").trim();
    if (isColor(normalized)) {
      return normalized.toUpperCase();
    }

    throw buildValidationError(createError, "color", "Workspace color must be a hex color like #0F6B54.");
  }

  function normalizeDenyEmails(rawEmails) {
    if (!Array.isArray(rawEmails)) {
      return {
        value: null,
        valid: false
      };
    }

    const normalized = [];
    for (const rawEmail of rawEmails) {
      const email = normalizeEmailValue(rawEmail);
      if (!email || !BASIC_EMAIL_PATTERN.test(email)) {
        return {
          value: null,
          valid: false
        };
      }

      normalized.push(email);
    }

    return {
      value: Array.from(new Set(normalized)),
      valid: true
    };
  }

  function normalizeAssistantSystemPromptValue(value, fieldName) {
    if (value == null) {
      return "";
    }

    const normalized = String(value || "").trim();
    if (normalized.length <= maxPromptLength) {
      return normalized;
    }

    throw buildValidationError(createError, fieldName, `System prompt must be at most ${maxPromptLength} characters.`);
  }

  function parseWorkspaceSettingsPatch(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const fieldErrors = {};
    const workspacePatch = {};
    const settingsPatch = {};

    if (Object.hasOwn(body, "name")) {
      const name = String(body.name || "").trim();
      if (!name) {
        fieldErrors.name = "Workspace name is required.";
      } else if (name.length > 160) {
        fieldErrors.name = "Workspace name must be at most 160 characters.";
      } else {
        workspacePatch.name = name;
      }
    }

    if (Object.hasOwn(body, "avatarUrl")) {
      try {
        workspacePatch.avatarUrl = normalizeWorkspaceAvatarUrl(body.avatarUrl);
      } catch (error) {
        fieldErrors.avatarUrl = String(error?.details?.fieldErrors?.avatarUrl || "Workspace avatar URL is invalid.");
      }
    }

    if (Object.hasOwn(body, "color")) {
      try {
        workspacePatch.color = normalizeWorkspaceColorValue(body.color);
      } catch (error) {
        fieldErrors.color = String(error?.details?.fieldErrors?.color || "Workspace color is invalid.");
      }
    }

    if (Object.hasOwn(body, "invitesEnabled")) {
      if (typeof body.invitesEnabled !== "boolean") {
        fieldErrors.invitesEnabled = "Invites enabled must be a boolean.";
      } else {
        settingsPatch.invitesEnabled = body.invitesEnabled;
      }
    }

    if (Object.hasOwn(body, "assistantTranscriptMode")) {
      const value = String(body.assistantTranscriptMode || "")
        .trim()
        .toLowerCase();
      if (!allowedTranscriptModes.includes(value)) {
        fieldErrors.assistantTranscriptMode = "assistantTranscriptMode must be one of: standard, restricted, disabled.";
      } else {
        settingsPatch.aiTranscriptMode = value;
      }
    }

    if (Object.hasOwn(body, "assistantSystemPromptApp")) {
      try {
        settingsPatch.assistantSystemPrompts = {
          ...(settingsPatch.assistantSystemPrompts || {}),
          app: normalizeAssistantSystemPromptValue(body.assistantSystemPromptApp, "assistantSystemPromptApp")
        };
      } catch (error) {
        fieldErrors.assistantSystemPromptApp = String(
          error?.details?.fieldErrors?.assistantSystemPromptApp || "assistantSystemPromptApp is invalid."
        );
      }
    }

    let appSurfaceAccessPatch = null;

    if (Object.hasOwn(body, "appDenyEmails")) {
      const parsedDenyEmails = normalizeDenyEmails(body.appDenyEmails);
      if (!parsedDenyEmails.valid) {
        fieldErrors.appDenyEmails = "App deny emails must be an array of valid email addresses.";
      } else {
        appSurfaceAccessPatch = {
          ...(appSurfaceAccessPatch || {}),
          denyEmails: parsedDenyEmails.value
        };
      }
    }

    if (Object.hasOwn(body, "appDenyUserIds")) {
      const parsedDenyUserIds = normalizeDenyUserIds(body.appDenyUserIds);
      if (!parsedDenyUserIds.valid) {
        fieldErrors.appDenyUserIds = "App deny user ids must be an array of positive integers.";
      } else {
        appSurfaceAccessPatch = {
          ...(appSurfaceAccessPatch || {}),
          denyUserIds: parsedDenyUserIds.value
        };
      }
    }

    if (appSurfaceAccessPatch) {
      settingsPatch.appSurfaceAccess = appSurfaceAccessPatch;
    }

    return {
      workspacePatch,
      settingsPatch,
      fieldErrors
    };
  }

  return {
    parseWorkspaceSettingsPatch
  };
}

export { createWorkspaceSettingsPatchPolicy };
