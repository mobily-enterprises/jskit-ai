// Native integration facts, separate from an application's offered models,
// recommended thinking levels, account permissions and billing presentation.
const model = (id, contextWindow, variants, options = {}) => Object.freeze({
  id, contextWindow, variants: Object.freeze(variants), ...options
});

const NATIVE_AI_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "deepseek", baseUrl: "https://api.deepseek.com/", claudeBaseUrl: "https://api.deepseek.com/anthropic",
    claudeAutoCompactWindow: 786432, webSearch: false,
    models: Object.freeze([
      model("deepseek-flash", 1048576, ["low", "high", "max"], { images: true, freeformPatch: true, codexHistoryRouting: true }),
      model("deepseek-v4-pro", 1048576, ["low", "high", "max"], { freeformPatch: true, codexHistoryRouting: true })
    ])
  }),
  Object.freeze({
    id: "zai-coding-plan", baseUrl: "https://api.z.ai/api/v1", claudeBaseUrl: "https://api.z.ai/api/anthropic",
    claudeAutoCompactWindow: 1000000, webSearch: false,
    models: Object.freeze([
      model("glm-5.3", 1048576, ["low", "high", "max"], { freeformPatch: true, codexHistoryRouting: true })
    ])
  }),
  Object.freeze({
    id: "zai", baseUrl: "https://api.z.ai/api/v1", claudeBaseUrl: "https://api.z.ai/api/anthropic",
    claudeAutoCompactWindow: 1000000, webSearch: false,
    models: Object.freeze([
      model("glm-5.3", 1048576, ["low", "high", "max"], { freeformPatch: true, codexHistoryRouting: true })
    ])
  })
]);

// A model server the person runs or reaches. Its route comes from their saved
// connection, never from this table: one base URL and one model per engine.
const CUSTOM_AI_PROVIDER_ID = "custom";
const CUSTOM_AI_MINIMUM_CONTEXT = 32768;
// Claude Code needs a token: without one it sends the saved claude.ai login.
const CUSTOM_AI_PLACEHOLDER_TOKEN = "local";

/**
 * The native shape of a custom endpoint for one engine. Codex gets reasoning
 * levels (its catalogue needs them); Claude Code and OpenCode get none, so no
 * effort the server may not understand is sent. Freeform patching and parallel
 * tool calls stay off: Codex refuses Ollama's freeform apply_patch replies.
 * @param {{ engineId?: string, baseUrl: string, model: string, contextWindow: number, label?: string }} connection
 */
function customAiProvider({ engineId = "codex", baseUrl, model: modelId, contextWindow, label = "Custom endpoint" }) {
  const variants = engineId === "codex" ? ["low", "medium", "high"] : [];
  return Object.freeze({
    id: CUSTOM_AI_PROVIDER_ID,
    custom: true,
    label,
    baseUrl,
    claudeBaseUrl: baseUrl,
    claudeAutoCompactWindow: contextWindow,
    webSearch: false,
    models: Object.freeze([model(modelId, contextWindow, variants, {
      label: modelId, defaultThinking: variants.length ? "medium" : "", parallelToolCalls: false,
      codexHistoryRouting: true
    })])
  });
}

/** The provider of a resolved connection: a fixed route, or the custom endpoint it carries. */
function connectionAiProvider(providerId, connection) {
  if (providerId === CUSTOM_AI_PROVIDER_ID) return connection?.provider?.custom === true ? connection.provider : null;
  return nativeAiProvider(providerId);
}

function nativeAiProvider(id) {
  return NATIVE_AI_PROVIDERS.find(provider => provider.id === id) || null;
}

function nativeAiModel(id, providerId = "") {
  for (const provider of NATIVE_AI_PROVIDERS) {
    if (providerId && provider.id !== providerId) continue;
    const model = provider.models.find(candidate => candidate.id === id);
    if (model) return { ...model, modelProviderId: provider.id };
  }
  return null;
}

export {
  CUSTOM_AI_MINIMUM_CONTEXT,
  CUSTOM_AI_PLACEHOLDER_TOKEN,
  CUSTOM_AI_PROVIDER_ID,
  NATIVE_AI_PROVIDERS,
  connectionAiProvider,
  customAiProvider,
  nativeAiProvider,
  nativeAiModel
};
