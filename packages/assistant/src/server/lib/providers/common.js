import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SUPPORTED_AI_PROVIDERS = Object.freeze(["openai", "deepseek", "anthropic"]);
const SUPPORTED_AI_PROVIDER_SET = new Set(SUPPORTED_AI_PROVIDERS);
const DEFAULT_AI_PROVIDER = "openai";
const DEFAULT_AI_TIMEOUT_MS = 120_000;

function normalizeProvider(provider) {
  const normalizedProvider = normalizeText(provider).toLowerCase() || DEFAULT_AI_PROVIDER;
  if (SUPPORTED_AI_PROVIDER_SET.has(normalizedProvider)) {
    return normalizedProvider;
  }

  throw new TypeError(
    `Unsupported assistant provider: ${normalizedProvider}. Supported providers: ${SUPPORTED_AI_PROVIDERS.join(", ")}.`
  );
}

function normalizeTimeoutMs(value, fallback = DEFAULT_AI_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeModel(value, fallback = "") {
  return normalizeText(value) || fallback;
}

function normalizeOptionalHttpUrl(value, { context = "assistant baseUrl" } = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${context} must be an absolute http(s) URL.`);
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new TypeError(`${context} must be an absolute http(s) URL.`);
  }

  const serialized = parsed.toString();
  return serialized.replace(/\/+$/g, "") || serialized;
}

function createDisabledClient({ provider = DEFAULT_AI_PROVIDER, model = "" } = {}) {
  const disabledError = () => {
    throw new AppError(503, "Assistant provider is not configured.");
  };

  return Object.freeze({
    enabled: false,
    provider,
    defaultModel: model,
    async createChatCompletion() {
      disabledError();
    },
    async createChatCompletionStream() {
      disabledError();
    }
  });
}

function createProviderRequestError({ status = 500, code = "assistant_provider_failed", message = "" } = {}) {
  const normalizedStatus = Number.isInteger(Number(status)) ? Number(status) : 500;
  const safeStatus = normalizedStatus >= 400 && normalizedStatus <= 599 ? normalizedStatus : 500;
  const normalizedCode = normalizeText(code) || "assistant_provider_failed";
  const normalizedMessage =
    normalizeText(message) || (safeStatus >= 500 ? "Assistant provider request failed." : "Request failed.");

  return new AppError(safeStatus, normalizedMessage, {
    code: normalizedCode
  });
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeContentText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const block = normalizeObject(entry);
      if (block.type === "text") {
        return String(block.text || "");
      }

      return String(block.text || "");
    })
    .join("");
}

function parseJsonObjectOrDefault(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  const source = normalizeText(value);
  if (!source) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore malformed JSON and fallback to empty object.
  }

  return fallback;
}

export {
  SUPPORTED_AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_TIMEOUT_MS,
  normalizeProvider,
  normalizeTimeoutMs,
  normalizeModel,
  normalizeOptionalHttpUrl,
  createDisabledClient,
  createProviderRequestError,
  normalizeObject,
  normalizeArray,
  normalizeContentText,
  parseJsonObjectOrDefault
};
