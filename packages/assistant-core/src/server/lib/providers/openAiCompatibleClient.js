import { createOpenAI } from "@ai-sdk/openai";
import { chatModel } from "@jskit-ai/agent/server";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createDisabledClient,
  normalizeModel,
  normalizeOptionalHttpUrl,
  normalizeTimeoutMs
} from "./common.js";

/**
 * An assistant client for an OpenAI-compatible chat completions API, or a disabled client without a key.
 * @param {{ enabled?: boolean, apiKey?: string, baseUrl?: string, model?: string, defaultModel?: string, provider?: string,
 *   timeoutMs?: number }} [options]
 */
function createOpenAiCompatibleClient({
  enabled = true,
  apiKey = "",
  baseUrl = "",
  model = "",
  defaultModel = "",
  provider = "openai",
  timeoutMs = 120_000
} = {}) {
  const normalizedApiKey = normalizeText(apiKey);
  const normalizedProvider = normalizeText(provider).toLowerCase() || "openai";
  const normalizedModel = normalizeModel(model, defaultModel);

  if (enabled !== true || !normalizedApiKey) {
    return createDisabledClient({
      provider: normalizedProvider,
      model: normalizedModel
    });
  }

  const normalizedBaseUrl = normalizeOptionalHttpUrl(baseUrl, {
    context: `assistant ${normalizedProvider} baseUrl`
  });
  // The OpenAI SDK (150 modules) loads with the first completion, not with every server that could ask for one.
  let clientPromise = null;
  const chatCompletions = async () => {
    clientPromise ??= import("openai").then(({ default: OpenAI }) => new OpenAI({
      apiKey: normalizedApiKey,
      ...(normalizedBaseUrl ? { baseURL: normalizedBaseUrl } : {}),
      timeout: normalizeTimeoutMs(timeoutMs)
    }));
    return (await clientPromise).chat.completions;
  };

  const baseURL = normalizedBaseUrl || undefined;

  async function createChatCompletion({ messages = [], tools = [], temperature = 0, signal } = {}) {
    const requestPayload = {
      model: normalizedModel,
      messages,
      ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
      temperature,
      stream: false
    };

    return (await chatCompletions()).create(requestPayload, signal ? { signal } : undefined);
  }

  async function createChatCompletionStream({ messages = [], tools = [], signal, temperature = 0.2 } = {}) {
    return (await chatCompletions()).create(
      {
        model: normalizedModel,
        messages,
        tools,
        temperature,
        stream: true
      },
      signal ? { signal } : undefined
    );
  }

  return Object.freeze({
    enabled: true,
    provider: normalizedProvider,
    defaultModel: normalizedModel,
    // The same endpoint as an AI SDK model, for the agent engine's loop.
    model: normalizedProvider === "deepseek"
      ? chatModel({ apiKey: normalizedApiKey, model: normalizedModel, baseURL })
      : createOpenAI({ apiKey: normalizedApiKey, baseURL }).chat(normalizedModel),
    createChatCompletion,
    createChatCompletionStream
  });
}

export { createOpenAiCompatibleClient };
