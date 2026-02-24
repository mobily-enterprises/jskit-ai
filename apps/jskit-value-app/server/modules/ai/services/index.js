import { createService as createAiService, __testables as aiServiceTestables } from "./ai.service.js";
import {
  createService as createAiTranscriptsService,
  __testables as aiTranscriptsServiceTestables
} from "./transcripts.service.js";

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
