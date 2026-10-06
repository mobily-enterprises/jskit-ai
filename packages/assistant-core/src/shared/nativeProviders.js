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
      model("deepseek-v4-pro", 1048576, ["low", "high", "max"], { freeformPatch: true })
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

export { NATIVE_AI_PROVIDERS, nativeAiProvider, nativeAiModel };
