import { createOpenAiClient as createOpenAiProviderClient } from "@jskit-ai/assistant-provider-openai/server";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

function createOpenAiClient(options = {}) {
  return createOpenAiProviderClient({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createOpenAiClient };
