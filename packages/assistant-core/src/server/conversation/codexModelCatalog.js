import { normalizeText as normalizeAgentText } from "./normalize.js";

// Bounded live model catalog, cached per provider connection generation.
export function codexAppServerModelCatalogError(message = "", errorPrefix = "") {
  const error = new Error(normalizeAgentText(message) || "Codex returned an invalid model catalog.");
  error.code = `${errorPrefix}codex_model_catalog_invalid`;
  return error;
}

export function codexAppServerProviderConnectionGeneration(provider = null) {
  const generation = typeof provider?.currentConnectionGeneration === "function"
    ? provider.currentConnectionGeneration()
    : typeof provider?.connectionGeneration === "function"
      ? provider.connectionGeneration()
      : provider?.connectionGeneration;
  return normalizeAgentText(generation || "");
}

function codexAppServerModelCatalogSnapshot(value = null, errorPrefix = "") {
  if (!Array.isArray(value?.data)) {
    throw codexAppServerModelCatalogError("Codex did not return a usable live model catalog.", errorPrefix);
  }
  return Object.freeze({
    data: Object.freeze(value.data.map((model = {}) => Object.freeze({
      hidden: model.hidden === true,
      model: normalizeAgentText(model.model || ""),
      supportedReasoningEfforts: Object.freeze((Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts
        : []).map((option = {}) => Object.freeze({
        reasoningEffort: normalizeAgentText(option.reasoningEffort || "")
      })))
    })))
  });
}

export function createCodexAppServerModelCatalogCache({
  cacheMs = 30_000,
  errorPrefix = ""
} = {}) {
  const codexAppServerModelCatalogs = new WeakMap();
  return async function readCodexAppServerModelCatalog(provider, { signal = null } = {}) {
    if (typeof provider.listModels !== "function") {
      const error = new Error("Codex live model discovery is unavailable.");
      error.code = `${errorPrefix}codex_model_catalog_unavailable`;
      throw error;
    }
    const connectionGeneration = codexAppServerProviderConnectionGeneration(provider);
    const now = Date.now();
    const cached = codexAppServerModelCatalogs.get(provider);
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.value &&
      cached.expiresAt > now
    ) {
      return cached.value;
    }
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.pending
    ) {
      return cached.pending;
    }

    const pending = provider.listModels({
      includeHidden: false,
      limit: 100
    }, { signal }).then((result) => {
      if (codexAppServerProviderConnectionGeneration(provider) !== connectionGeneration) {
        const error = new Error("Codex reconnected while resolving the helper model catalog.");
        error.code = `${errorPrefix}codex_model_catalog_stale`;
        throw error;
      }
      return codexAppServerModelCatalogSnapshot(result, errorPrefix);
    });
    codexAppServerModelCatalogs.set(provider, {
      connectionGeneration,
      expiresAt: 0,
      pending,
      value: null
    });
    try {
      const value = await pending;
      codexAppServerModelCatalogs.set(provider, {
        connectionGeneration,
        expiresAt: Date.now() + cacheMs,
        pending: null,
        value
      });
      return value;
    } catch (error) {
      if (codexAppServerModelCatalogs.get(provider)?.pending === pending) {
        codexAppServerModelCatalogs.delete(provider);
      }
      throw error;
    }
  };
}
