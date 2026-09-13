import { createSchema } from "json-rest-schema";
import snapshot from "./ai-models.json" with { type: "json" };

const DEFAULT_AI_MODEL = "opencode/big-pickle";
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
const models = new Map(aiCatalogue.providers.flatMap((provider) => provider.models.map((model) => [model.key, model])));

function getAiModel(key) { return models.get(key); }

function listAiModels({ providerId, access, includeDeprecated = false, configurableOnly = false } = {}) {
  const order = ["free-no-setup", "free-with-connection", "paid", "unknown"];
  return aiCatalogue.providers.filter((provider) => (!providerId || provider.id === providerId) &&
    (!configurableOnly || provider.connection === "api-key"))
    .flatMap((provider) => provider.models).filter((model) =>
      (includeDeprecated || model.status !== "deprecated") && (!access || model.access === access))
    .sort((a, b) => a.key === DEFAULT_AI_MODEL ? -1 : b.key === DEFAULT_AI_MODEL ? 1 :
      order.indexOf(a.access) - order.indexOf(b.access) || a.key.localeCompare(b.key));
}

const modelItems = Object.freeze(listAiModels({ configurableOnly: true }).map((model) => Object.freeze({
  value: model.key, title: `${model.name} (${model.providerId})`, props: { subtitle: aiAccessLabels[model.access] }
})));
const aiDefinition = Object.freeze({
  id: "ai", name: "AI", description: "Choose an app AI model and whose account pays. Big Pickle starts without an account or key.",
  accountModes: ["shared", "per-user"], authenticationMethods: ["none", "api-key"], scopes: [],
  authenticationMethodsForSettings: (settings = {}) => getAiModel(settings.model ?? DEFAULT_AI_MODEL)?.access === "free-no-setup"
    ? ["none", "api-key"] : ["api-key"],
  authenticationLabels: { none: "Free access · no account or key", "api-key": "Use a provider API key" },
  authenticationHint: "Your app calls the provider directly. A shared account belongs to the app administrator; individual accounts belong to each signed-in app user.",
  settingsSchema: createSchema({ model: { type: "string", defaultTo: DEFAULT_AI_MODEL,
    enum: modelItems.map((item) => item.value) } }),
  settingsFields: [{ name: "model", label: "AI model", searchable: true, items: modelItems,
    credentialScope: (key) => getAiModel(key)?.providerId,
    hint: (settings = {}) => {
      const model = getAiModel(settings.model ?? DEFAULT_AI_MODEL);
      return `${model ? `${model.name}: ${aiAccessLabels[model.access]}. ` : ""}Search by provider or model. Catalogue dated 10 September 2026; availability can change. No automatic paid fallback.`;
    } }],
  apiKeyReferenceHint: "Use an environment reference for an administrator key. For individual accounts, use a private reference your app resolves for the authenticated user. Never put a key in this file.",
  setup: {
    url: "https://opencode.ai/docs/zen/",
    steps: [
      "Big Pickle and other choices labelled no account or key need no registration. Save and use this model through your application's AI library.",
      "For a connected model, create a regular API key in that provider's dashboard. Z.AI's GLM-4.7-Flash uses a regular Z.AI key; its Coding Plan is a different product.",
      "For a shared account, store the administrator's key in Env. For individual accounts, your application must provide private key entry, storage and disconnect controls for each authenticated user.",
      "Saving selects configuration; it does not verify a provider account or install an AI library into your application. Follow the AI connection guide for the selected framework."
    ]
  }
});

export { aiCatalogue, aiAccessLabels, aiDefinition, DEFAULT_AI_MODEL, getAiModel, listAiModels };
