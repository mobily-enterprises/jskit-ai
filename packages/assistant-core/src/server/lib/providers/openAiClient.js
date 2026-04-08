import { createOpenAiCompatibleClient } from "./openAiCompatibleClient.js";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function createOpenAiClient(options = {}) {
  return createOpenAiCompatibleClient({
    ...options,
    provider: "openai",
    defaultModel: DEFAULT_OPENAI_MODEL
  });
}

export { createOpenAiClient, DEFAULT_OPENAI_MODEL };
