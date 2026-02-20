const AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH = 4000;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePromptValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH);
}

function resolveFeatures(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value;
}

function resolveAiSystemPrompts(features) {
  const normalizedFeatures = resolveFeatures(features);
  const ai = resolveFeatures(normalizedFeatures.ai);
  return resolveFeatures(ai.systemPrompts);
}

function resolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings) {
  const features = resolveFeatures(workspaceSettings?.features);
  const prompts = resolveAiSystemPrompts(features);
  return normalizePromptValue(prompts.app);
}

function resolveAssistantSystemPromptsFromWorkspaceSettings(workspaceSettings) {
  return {
    app: resolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings)
  };
}

function resolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings) {
  const features = resolveFeatures(consoleSettings?.features);
  const prompts = resolveAiSystemPrompts(features);
  return normalizePromptValue(prompts.workspace);
}

function applyAssistantSystemPromptAppToWorkspaceFeatures(features, promptValue = "") {
  const currentFeatures = resolveFeatures(features);
  const currentAi = resolveFeatures(currentFeatures.ai);
  const currentPrompts = resolveAiSystemPrompts(currentFeatures);

  return {
    ...currentFeatures,
    ai: {
      ...currentAi,
      systemPrompts: {
        ...currentPrompts,
        app: normalizePromptValue(promptValue)
      }
    }
  };
}

function applyAssistantSystemPromptsToWorkspaceFeatures(features, promptPatch = {}) {
  if (!Object.prototype.hasOwnProperty.call(promptPatch, "app")) {
    return resolveFeatures(features);
  }

  return applyAssistantSystemPromptAppToWorkspaceFeatures(features, promptPatch.app);
}

function applyAssistantSystemPromptWorkspaceToConsoleFeatures(features, promptValue = "") {
  const currentFeatures = resolveFeatures(features);
  const currentAi = resolveFeatures(currentFeatures.ai);
  const currentPrompts = resolveAiSystemPrompts(currentFeatures);

  return {
    ...currentFeatures,
    ai: {
      ...currentAi,
      systemPrompts: {
        ...currentPrompts,
        workspace: normalizePromptValue(promptValue)
      }
    }
  };
}

export {
  AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH,
  normalizePromptValue,
  resolveAssistantSystemPromptAppFromWorkspaceSettings,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings,
  resolveAssistantSystemPromptsFromWorkspaceSettings,
  applyAssistantSystemPromptAppToWorkspaceFeatures,
  applyAssistantSystemPromptsToWorkspaceFeatures,
  applyAssistantSystemPromptWorkspaceToConsoleFeatures
};
