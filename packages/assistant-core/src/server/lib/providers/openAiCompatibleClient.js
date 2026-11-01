import OpenAI from "openai";
import { createOpenAI } from "@ai-sdk/openai";
import { chatModel } from "@jskit-ai/agent/server";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createDisabledClient,
  normalizeModel,
  normalizeOptionalHttpUrl,
  normalizeTimeoutMs
} from "./common.js";

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
  const client = new OpenAI({
    apiKey: normalizedApiKey,
    ...(normalizedBaseUrl ? { baseURL: normalizedBaseUrl } : {}),
    timeout: normalizeTimeoutMs(timeoutMs)
  });

  const baseURL = normalizedBaseUrl || undefined;
  return Object.freeze({
    enabled: true,
    provider: normalizedProvider,
    defaultModel: normalizedModel,
    // The same endpoint as an AI SDK model, for the agent engine's loop.
    model: normalizedProvider === "deepseek"
      ? chatModel({ apiKey: normalizedApiKey, model: normalizedModel, baseURL })
      : createOpenAI({ apiKey: normalizedApiKey, baseURL }).chat(normalizedModel),
    async createChatCompletion({ messages = [], tools = [], temperature = 0, signal } = {}) {
      const requestPayload = {
        model: normalizedModel,
        messages,
        ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
        temperature,
        stream: false
      };

      return client.chat.completions.create(requestPayload, signal ? { signal } : undefined);
    },
    async createChatCompletionStream({ messages = [], tools = [], signal, temperature = 0.2 } = {}) {
      return client.chat.completions.create(
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
  });
}

export { createOpenAiCompatibleClient };
