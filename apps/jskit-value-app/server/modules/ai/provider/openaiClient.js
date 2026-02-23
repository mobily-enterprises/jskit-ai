import { createOpenAiClient as createOpenAiProviderClient } from "@jskit-ai/assistant-provider-openai";
import { AppError } from "../../../lib/errors.js";

function createOpenAiClient(options = {}) {
  return createOpenAiProviderClient({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createOpenAiClient };
