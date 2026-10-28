// "@jskit-ai/connectors-catalog/shared/ai" in English; the keyed texts are in ai.js.
import { aiAccessLabels as keyedAccessLabels, aiDefinition as keyedDefinition } from "./ai.js";
import { englishTexts } from "./english-texts.js";

export { aiCatalogue, getAiModel, listAiModels } from "./ai.js";
export const { aiAccessLabels, aiDefinition } = englishTexts({ aiAccessLabels: keyedAccessLabels, aiDefinition: keyedDefinition });
