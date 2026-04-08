import { createOpenAiClient } from "./providers/openAiClient.js";
import { createDeepSeekClient } from "./providers/deepSeekClient.js";
import { createAnthropicClient } from "./providers/anthropicClient.js";
import {
  DEFAULT_AI_PROVIDER,
  SUPPORTED_AI_PROVIDERS,
  normalizeModel,
  normalizeProvider,
  normalizeTimeoutMs
} from "./providers/common.js";

function createAiClient(options = {}) {
  const provider = normalizeProvider(options.provider || DEFAULT_AI_PROVIDER);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const commonOptions = {
    ...options,
    provider,
    timeoutMs,
    model: normalizeModel(options.model)
  };

  if (provider === "openai") {
    return createOpenAiClient(commonOptions);
  }

  if (provider === "deepseek") {
    return createDeepSeekClient(commonOptions);
  }

  if (provider === "anthropic") {
    return createAnthropicClient(commonOptions);
  }

  throw new TypeError(
    `Unsupported assistant provider: ${provider}. Supported providers: ${SUPPORTED_AI_PROVIDERS.join(", ")}.`
  );
}

export {
  createAiClient,
  SUPPORTED_AI_PROVIDERS,
  DEFAULT_AI_PROVIDER
};
