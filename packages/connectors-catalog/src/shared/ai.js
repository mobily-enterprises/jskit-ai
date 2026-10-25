import { createSchema } from "json-rest-schema";
import snapshot from "./ai-models.json" with { type: "json" };

const aiAccessLabels = Object.freeze({
  "free-no-setup": "Free · no account or key",
  "free-with-connection": "Free · connection required",
  paid: "Paid · connection required",
  unknown: "Pricing unknown · check provider"
});
// These direct API-key routes need no coding subscription or cloud identity
// exchange. Other upstream entries remain available as framework metadata.
const directProviders = new Set(["opencode", "zai", "openai", "anthropic", "deepseek", "google", "openrouter",
  "groq", "mistral", "xai", "cerebras", "togetherai", "perplexity"]);
const aiCatalogue = Object.freeze({ ...snapshot, providers: Object.freeze(snapshot.providers.map((provider) => Object.freeze({
  ...provider, connection: directProviders.has(provider.id) ? "api-key" : "framework",
  models: Object.freeze(provider.models.map((model) => Object.freeze({ ...model, key: `${provider.id}/${model.id}`, providerId: provider.id })))
}))) });
const catalogueDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  .format(new Date(snapshot.extractedAt));
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
  id: "ai", name: "AI", description: "Choose an app AI provider, model and whose account pays. No model is preselected.",
  accountModes: ["shared", "per-user"], authenticationMethods: ["api-key", "none"], scopes: [],
  authenticationMethodsForSettings: (settings = {}) => getAiModel(settings.model)?.access === "free-no-setup"
    ? ["none", "api-key"] : ["api-key"],
  authenticationLabels: { none: "Free access · no account or key", "api-key": "Use a provider API key" },
  authenticationHint: "Your app calls the provider directly. A shared account belongs to the app administrator; individual accounts belong to each signed-in app user.",
  settingsSchema: createSchema({ model: { type: "string", required: true,
    enum: modelItems.map((item) => item.value) } }),
  settingsFields: [{ name: "model", label: "AI model", searchable: true, items: modelItems,
    credentialScope: (key) => getAiModel(key)?.providerId,
    hint: (settings = {}) => {
      const model = getAiModel(settings.model);
      return `${model ? `${model.name}: ${aiAccessLabels[model.access]}. ` : "Choose a provider and model. "}Search by provider or model. Catalogue dated ${catalogueDate}; availability can change. No automatic paid fallback.`;
    } }],
  apiKeyReferenceHint: "Use an environment reference for an administrator key. For individual accounts, use a private reference your app resolves for the authenticated user. Never put a key in this file.",
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
