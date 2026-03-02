import { createService as createAiService, __testables as aiServiceTestables } from "./ai.service.js";
import {
  createService as createAiTranscriptsService,
  __testables as aiTranscriptsServiceTestables
} from "./transcripts.service.js";
import { resolveScopedServiceOptions } from "../lib/scopedServiceOptions.js";

function createService(options = {}) {
  const { source, aiServiceOptions, aiTranscriptsServiceOptions } = resolveScopedServiceOptions(options);
  const aiTranscriptsService = source.aiTranscriptsService ?? createAiTranscriptsService(aiTranscriptsServiceOptions);
  const aiService =
    source.aiService ??
    createAiService({
      ...aiServiceOptions,
      aiTranscriptsService
    });

  return {
    aiService,
    aiTranscriptsService
  };
}

const __testables = Object.freeze({
  aiServiceTestables,
  aiTranscriptsServiceTestables
});

export { createService, __testables };
