import { createSchema } from "json-rest-schema";
import snapshot from "./ai-models.json" with { type: "json" };

// Message keys; render them with the app's text helper (useJskitText().text).
const aiAccessLabels = Object.freeze({
  "free-no-setup": "jskit.connectors.ai.access.freeNoSetup",
  "free-with-connection": "jskit.connectors.ai.access.freeWithConnection",
  paid: "jskit.connectors.ai.access.paid",
  unknown: "jskit.connectors.ai.access.unknown"
});
const selectedModelHints = Object.freeze({
  "free-no-setup": "jskit.connectors.ai.fields.model.selectedHint.freeNoSetup",
  "free-with-connection": "jskit.connectors.ai.fields.model.selectedHint.freeWithConnection",
  paid: "jskit.connectors.ai.fields.model.selectedHint.paid",
  unknown: "jskit.connectors.ai.fields.model.selectedHint.unknown"
});
// These direct API-key routes need no coding subscription or cloud identity
// exchange. Other upstream entries remain available as framework metadata.
const directProviders = new Set(["opencode", "zai", "openai", "anthropic", "deepseek", "google", "openrouter",
  "groq", "mistral", "xai", "cerebras", "togetherai", "perplexity"]);
const aiCatalogue = Object.freeze({ ...snapshot, providers: Object.freeze(snapshot.providers.map((provider) => Object.freeze({
  ...provider, connection: directProviders.has(provider.id) ? "api-key" : "framework",
  models: Object.freeze(provider.models.map((model) => Object.freeze({ ...model, key: `${provider.id}/${model.id}`, providerId: provider.id })))
}))) });
const catalogueDateFormat = Object.freeze({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const models = new Map(aiCatalogue.providers.flatMap((provider) => provider.models.map((model) => [model.key, model])));

function getAiModel(key) { return models.get(key); }

function listAiModels({ providerId, access, includeDeprecated = false, configurableOnly = false } = {}) {
  const order = ["free-no-setup", "free-with-connection", "paid", "unknown"];
  return aiCatalogue.providers.filter((provider) => (!providerId || provider.id === providerId) &&
    (!configurableOnly || provider.connection === "api-key"))
    .flatMap((provider) => provider.models).filter((model) =>
      (includeDeprecated || model.status !== "deprecated") && (!access || model.access === access))
    .sort((a, b) => order.indexOf(a.access) - order.indexOf(b.access) || a.key.localeCompare(b.key));
}

const modelItems = Object.freeze(listAiModels({ configurableOnly: true }).map((model) => Object.freeze({
  value: model.key, title: `${model.name} (${model.providerId})`, props: { subtitle: aiAccessLabels[model.access] }
})));
const aiDefinition = Object.freeze({
  id: "ai", name: "AI", description: "jskit.connectors.ai.description",
  accountModes: ["shared", "per-user"], authenticationMethods: ["api-key", "none"], scopes: [],
  authenticationMethodsForSettings: (settings = {}) => getAiModel(settings.model)?.access === "free-no-setup"
    ? ["none", "api-key"] : ["api-key"],
  authenticationLabels: { none: "jskit.connectors.ai.authenticationLabels.none", "api-key": "jskit.connectors.ai.authenticationLabels.apiKey" },
  authenticationHint: "jskit.connectors.ai.authenticationHint",
  settingsSchema: createSchema({ model: { type: "string", required: true,
    enum: modelItems.map((item) => item.value) } }),
  settingsFields: [{ name: "model", label: "jskit.connectors.ai.fields.model.label", searchable: true, items: modelItems,
    credentialScope: (key) => getAiModel(key)?.providerId,
    // The catalogue date is display text: formatDate (useJskitText's) uses the app's active
    // locale; without an app language it keeps its fixed English form.
    hint: (settings = {}, { formatDate } = {}) => {
      const model = getAiModel(settings.model);
      const date = formatDate ? formatDate(snapshot.extractedAt, catalogueDateFormat)
        : new Date(snapshot.extractedAt).toLocaleDateString("en-GB", catalogueDateFormat);
      return model ? { key: selectedModelHints[model.access], params: { model: model.name, date } }
        : { key: "jskit.connectors.ai.fields.model.hint", params: { date } };
    } }],
  apiKeyReferenceHint: "jskit.connectors.ai.apiKeyReferenceHint",
  setup: {
    url: "https://opencode.ai/docs/zen/",
    steps: [
      "Choose a provider and model; no model is preselected. Create a regular API key in that provider's dashboard. Z.AI's GLM-4.7-Flash uses a regular Z.AI key; its Coding Plan is a different product.",
      "For a shared account, store the administrator's key in Env. For individual accounts, your application must provide private key entry, storage and disconnect controls for each authenticated user.",
      "Saving selects configuration; it does not verify a provider account or install an AI library into your application. Follow the AI connection guide for the selected framework."
    ]
  }
});

export { aiCatalogue, aiAccessLabels, aiDefinition, getAiModel, listAiModels };
