import { createApiConversationDriver } from "./providers/api.js";
import { createClaudeConversationDriver } from "./providers/claudeDriver.js";
import { createCodexConversationDriver } from "./providers/codexDriver.js";
import { createOpenCodeConversationDriver } from "./providers/opencodeDriver.js";
import { validateCommandWrapper } from "./commandWrapper.js";

/**
 * Creates the engine driver a conversation runs on and opens its provider. The connections,
 * limits and application tools are shared by every driver; each call names its host.
 * @param {object} options
 * @param {import("../types.js").ConversationConnections | undefined} options.connections
 * @param {import("../types.js").ConversationApiClientFactory | undefined} options.apiClientFactory
 * @param {typeof fetch | undefined} options.fetch
 * @param {import("../types.js").ConversationLimits} options.limits
 * @param {object | undefined} options.actions The application actions offered as tools, when there are any.
 * @param {import("../types.js").ServiceToolCatalog | undefined} options.toolCatalog
 */
export function createConversationProviderFactory({ connections, apiClientFactory, fetch, limits, actions, toolCatalog }) {
  function createDriver(engine, host) {
    if (host?.nativeTools !== undefined && typeof host.nativeTools !== "boolean") throw new TypeError("host.nativeTools must be an explicit server-side boolean grant.");
    if (host?.commandWrapper !== undefined) {
      validateCommandWrapper(host.commandWrapper);
      if (host.nativeTools !== true || engine === "api") throw new TypeError("A command wrapper requires native coding tools.");
    }
    const driver = engine === "api" ? createApiConversationDriver({ connections, apiClientFactory, fetch, limits })
      : engine === "claude" ? createClaudeConversationDriver({ connections, host, limits })
        : engine === "codex" ? createCodexConversationDriver({ connections, fetch, host, limits })
          : engine === "opencode" ? createOpenCodeConversationDriver({ connections, host, limits }) : null;
    if (!driver) throw new TypeError(`The common conversation runtime does not yet support ${engine}.`);
    if ((actions || toolCatalog) && !driver.capabilities.tools) throw new TypeError(`Application tools are not yet supported by the ${engine} conversation adapter.`);
    return driver;
  }

  function open(driver, { binding, conversation, onFailure, writeBinding }) {
    return driver.open({ binding, conversation, onFailure, writeBinding });
  }

  return Object.freeze({
    createDriver,
    open
  });
}

/** @typedef {ReturnType<typeof createConversationProviderFactory>} ConversationProviderFactory */
/** @typedef {ReturnType<ConversationProviderFactory["createDriver"]>} ConversationDriver */
