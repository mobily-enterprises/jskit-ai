import { createOpenAiClient as createOpenAiProviderClient } from "../../../../../../packages/ai-agent/assistant-provider-openai/src/openaiClient.js";
import { AppError } from "../../../lib/errors.js";

function createOpenAiClient(options = {}) {
  return createOpenAiProviderClient({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createOpenAiClient };
