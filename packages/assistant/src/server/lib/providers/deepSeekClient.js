import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createOpenAiCompatibleClient } from "./openAiCompatibleClient.js";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function createDeepSeekClient(options = {}) {
  const normalizedBaseUrl = normalizeText(options.baseUrl) || DEFAULT_DEEPSEEK_BASE_URL;

  return createOpenAiCompatibleClient({
    ...options,
    provider: "deepseek",
    baseUrl: normalizedBaseUrl,
    defaultModel: DEFAULT_DEEPSEEK_MODEL
  });
}

export {
  createDeepSeekClient,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_BASE_URL
};
