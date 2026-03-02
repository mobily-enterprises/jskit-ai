import OpenAI from "openai";

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

function createDisabledProvider(AppErrorClass = DefaultAppError) {
  return {
    enabled: false,
    provider: "openai",
    async createChatCompletion() {
      throw new AppErrorClass(404, "Not found.");
    },
    async createChatCompletionStream() {
      throw new AppErrorClass(404, "Not found.");
    }
  };
}

function createOpenAiClient({
  enabled = false,
  provider = "openai",
  apiKey = "",
  baseUrl = "",
  timeoutMs = 45_000,
  appErrorClass = null
} = {}) {
  const AppErrorClass = typeof appErrorClass === "function" ? appErrorClass : DefaultAppError;
  if (enabled !== true) {
    return createDisabledProvider(AppErrorClass);
  }

  const normalizedProvider = String(provider || "openai")
    .trim()
    .toLowerCase();
  if (normalizedProvider !== "openai") {
    throw new Error(`Unsupported AI provider: ${normalizedProvider || "unknown"}.`);
  }

  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("AI_API_KEY is required when AI is enabled in config/ai.js.");
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

const __testables = {
  DefaultAppError,
  createDisabledProvider
};

export { createOpenAiClient, __testables };
