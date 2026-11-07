import framework from "./ai-framework-models.json" with { type: "json" };
import { aiAccessLabels, aiDefinition, byAccessThenKey, catalogueProvider, configurableProviders } from "./ai-definition.js";
import snapshot from "./ai-models.json" with { type: "json" };

// The whole model catalogue: the configurable providers and the framework-metadata ones (other upstream entries,
// not configurable), in provider id order.
const aiCatalogue = Object.freeze({ ...snapshot, providers: Object.freeze([...configurableProviders,
  ...framework.providers.map((provider) => catalogueProvider(provider, "framework"))]
  .sort((a, b) => (a.id < b.id ? -1 : 1))) });
const models = new Map(aiCatalogue.providers.flatMap((provider) => provider.models.map((model) => [model.key, model])));

function getAiModel(key) { return models.get(key); }

function listAiModels({ providerId, access, includeDeprecated = false, configurableOnly = false } = {}) {
  return aiCatalogue.providers.filter((provider) => (!providerId || provider.id === providerId) &&
    (!configurableOnly || provider.connection === "api-key"))
    .flatMap((provider) => provider.models).filter((model) =>
      (includeDeprecated || model.status !== "deprecated") && (!access || model.access === access))
    .sort(byAccessThenKey);
}

export { aiCatalogue, aiAccessLabels, aiDefinition, getAiModel, listAiModels };
