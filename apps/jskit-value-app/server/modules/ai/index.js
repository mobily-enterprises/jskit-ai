import { createService as createAiService } from "./services/ai.service.js";
import { createService as createAiTranscriptsService } from "./services/transcripts.service.js";
import { createRepository as createAiRepository } from "./repositories/index.js";
import { createOpenAiClient } from "./lib/provider/openaiClient.js";

function createService(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const aiServiceOptions =
    source.aiServiceOptions && typeof source.aiServiceOptions === "object" ? source.aiServiceOptions : source;
  const aiTranscriptsServiceOptions =
    source.aiTranscriptsServiceOptions && typeof source.aiTranscriptsServiceOptions === "object"
      ? source.aiTranscriptsServiceOptions
      : source;
  const aiTranscriptsService = source.aiTranscriptsService ?? createAiTranscriptsService(aiTranscriptsServiceOptions);
  const aiService =
    source.aiService ??
    createAiService({
      ...aiServiceOptions,
      providerClient:
        aiServiceOptions.providerClient ??
        createOpenAiClient({
          enabled: aiServiceOptions.enabled,
          provider: aiServiceOptions.provider,
          apiKey: aiServiceOptions.apiKey,
          baseUrl: aiServiceOptions.baseUrl,
          timeoutMs: aiServiceOptions.timeoutMs
        }),
      aiTranscriptsService
    });

  return {
    aiService,
    aiTranscriptsService
  };
}

function createRepository() {
  return createAiRepository();
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
