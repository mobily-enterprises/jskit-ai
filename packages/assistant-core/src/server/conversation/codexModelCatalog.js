import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import { codexAppServerOwnedRuntimeKey, codexAppServerOwnedRuntimes, withRuntimeLifecycle } from "./codexRuntimeInventory.js";

// Bounded live model catalog, cached per provider connection generation.
export function codexAppServerModelCatalogError(message = "", errorPrefix = "") {
  const error = new Error(normalizeAgentText(message) || "Codex returned an invalid model catalog.");
  error.code = `${errorPrefix}codex_model_catalog_invalid`;
  return error;
}

/** @param {import("./codexProvider.js").CodexAppServerAgentProvider} provider */
export function codexAppServerProviderConnectionGeneration(provider) {
  return normalizeAgentText(provider.currentConnectionGeneration() || "");
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
    // readable-check: allow method-probe - safety invariant: a provider without live model discovery is refused with codex_model_catalog_unavailable
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

/**
 * The chat model catalogue an owner reads from its native runtime, cached per runtime identity. A runtime it
 * starts only for the read stops again.
 * @param {object} dependencies
 * @param {<T>(operation: () => T) => Promise<Awaited<T>>} dependencies.withLifecycle
 * @param {() => void} dependencies.assertOpen
 * @param {(request: { operation: () => Promise<object>, provider: object, providerOptions: object }) => Promise<object>} dependencies.acquireRuntime
 * @param {(record: object) => Promise<object>} dependencies.stopOwnedRuntime
 * @param {(provider: object) => void} dependencies.forgetOwnedRuntime
 */
export function createCodexRuntimeModelCatalog({ withLifecycle, assertOpen, acquireRuntime, stopOwnedRuntime, forgetOwnedRuntime }) {
  let codexAppServerChatModelCatalog = null;

  function readModelCatalog({
    prepareProviderOptions,
    providerFactory,
    resources = null,
    signal = null,
    cacheMs = 30_000
  } = {}) {
    return withLifecycle(async () => {
      assertOpen();
      signal?.throwIfAborted();
      const providerOptions = await prepareProviderOptions();
      return withRuntimeLifecycle(codexAppServerOwnedRuntimeKey("", providerOptions), async () => {
        const existing = codexAppServerOwnedRuntimes.get(
          codexAppServerOwnedRuntimeKey("", providerOptions)
        );
        const provider = existing?.provider || providerFactory(providerOptions);
        let runtime = null;
        let catalog = null;
        let identity = "";
        try {
          assertOpen();
          identity = JSON.stringify(await provider.currentRuntimeInfo());
          signal?.throwIfAborted();
          if (codexAppServerChatModelCatalog?.identity === identity &&
              codexAppServerChatModelCatalog.expiresAt > Date.now()) {
            return codexAppServerChatModelCatalog.value;
          }
          if (!existing?.provider) {
            runtime = await acquireRuntime({
              operation: () => provider.ensureRuntime(),
              provider,
              providerOptions
            });
          }
          catalog = await provider.listModels({ includeHidden: false, limit: 100 }, { signal });
        } finally {
          if (!existing?.provider) {
            try {
              if ((runtime || provider.runtime)?.reused === false) {
                await stopOwnedRuntime({ provider, resources });
              } else {
                forgetOwnedRuntime(provider);
              }
            } finally {
              provider.close();
            }
          }
        }
        codexAppServerChatModelCatalog = {
          expiresAt: Date.now() + cacheMs,
          identity,
          value: catalog
        };
        return catalog;
      });
    });
  }

  function forgetModelCatalog() {
    codexAppServerChatModelCatalog = null;
  }

  return Object.freeze({
    read: readModelCatalog,
    forget: forgetModelCatalog
  });
}
