import OpenAI from "openai";
import { AppError } from "../../../lib/errors.js";

function createDisabledProvider() {
  return {
    enabled: false,
    provider: "openai",
    async createChatCompletion() {
      throw new AppError(404, "Not found.");
    },
    async createChatCompletionStream() {
      throw new AppError(404, "Not found.");
    }
  };
}

function createOpenAiClient({
  enabled = false,
  provider = "openai",
  apiKey = "",
  baseUrl = "",
  timeoutMs = 45_000
} = {}) {
  if (enabled !== true) {
    return createDisabledProvider();
  }

  const normalizedProvider = String(provider || "openai")
    .trim()
    .toLowerCase();
  if (normalizedProvider !== "openai") {
    throw new Error(`Unsupported AI provider: ${normalizedProvider || "unknown"}.`);
  }

  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("AI_API_KEY is required when AI_ENABLED=true.");
  }

  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedTimeoutMs = Number(timeoutMs);
  const client = new OpenAI({
    apiKey: normalizedApiKey,
    ...(normalizedBaseUrl ? { baseURL: normalizedBaseUrl } : {}),
    ...(Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0 ? { timeout: normalizedTimeoutMs } : {})
  });

  return {
    enabled: true,
    provider: normalizedProvider,
    async createChatCompletion({ model, messages, temperature = 0 }) {
      return client.chat.completions.create({
        model,
        messages,
        temperature,
        stream: false
      });
    },
    async createChatCompletionStream({ model, messages, tools, signal, temperature = 0.2 }) {
      return client.chat.completions.create(
        {
          model,
          messages,
          tools,
          temperature,
          stream: true
        },
        {
          signal
        }
      );
    }
  };
}

export { createOpenAiClient };
