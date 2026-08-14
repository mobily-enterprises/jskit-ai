import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

function findTextMutation(id) {
  const mutations = Array.isArray(packageMetadata?.mutations?.text) ? packageMetadata.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant packageMetadata exposes setup as the primary command and still depends on assistant-runtime", () => {
  assert.equal(packageMetadata.kind, "generator");
  assert.equal(packageMetadata.metadata?.generatorPrimarySubcommand, "setup");
  assert.equal(packageMetadata.options?.surface?.required, true);
  assert.equal(packageMetadata.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(packageMetadata.options?.["settings-surface"]?.required, true);
  assert.equal(packageMetadata.options?.["settings-surface"]?.validationType, "enabled-surface-id");
  assert.equal(packageMetadata.options?.["config-scope"]?.defaultValue, "global");
  assert.equal(
    packageMetadata.options?.["ai-config-prefix"]?.defaultFromOptionTemplate,
    "${option:surface|snake|upper}_ASSISTANT"
  );
  assert.equal(packageMetadata.options?.name?.required, false);
  assert.equal(packageMetadata.options?.["link-placement"]?.required, false);
  assert.equal(packageMetadata.options?.["ai-base-url"]?.required, false);
  assert.match(packageJson.dependencies["@jskit-ai/assistant-runtime"], /^\d+\.\d+\.\d+$/u);
});

test("assistant packageMetadata defines explicit page subcommands and setup-only mutations", () => {
  const subcommands = packageMetadata.metadata?.generatorSubcommands || {};
  const fileMutations = Array.isArray(packageMetadata?.mutations?.files) ? packageMetadata.mutations.files : [];

  assert.equal(subcommands.setup?.description?.length > 0, true);
  assert.equal(subcommands.page?.entrypoint, "src/server/subcommands/page.js");
  assert.equal(subcommands["settings-page"]?.entrypoint, "src/server/subcommands/settingsPage.js");
  assert.equal(subcommands.page?.positionalArgs?.[0]?.name, "target-file");
  assert.equal(subcommands["settings-page"]?.requiredOptionNames?.[0], "surface");
  assert.equal(subcommands.page?.optionNames?.includes("force"), true);
  assert.equal(subcommands["settings-page"]?.optionNames?.includes("force"), true);
  assert.equal(fileMutations.length, 0);
});

test("assistant packageMetadata appends setup config and upserts assistant env entries", () => {
  const publicConfig = findTextMutation("assistant-public-surface-config");
  const serverConfig = findTextMutation("assistant-server-surface-config");
  const envProvider = findTextMutation("assistant-ai-provider");
  const envApiKey = findTextMutation("assistant-ai-api-key");
  const envBaseUrl = findTextMutation("assistant-ai-base-url");
  const envTimeout = findTextMutation("assistant-ai-timeout-ms");
  const textMutations = Array.isArray(packageMetadata?.mutations?.text) ? packageMetadata.mutations.text : [];

  assert.equal(textMutations.length, 6);
  assert.match(String(publicConfig?.value || ""), /config\.assistantSurfaces\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(publicConfig?.value || ""), /settingsSurfaceId: "__ASSISTANT_SETTINGS_SURFACE_ID__"/);
  assert.match(String(serverConfig?.value || ""), /config\.assistantServer\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(serverConfig?.value || ""), /aiConfigPrefix: "__ASSISTANT_AI_CONFIG_PREFIX__"/);
  assert.equal(envProvider?.op, "upsert-env");
  assert.equal(envProvider?.key, "${option:ai-config-prefix}_AI_PROVIDER");
  assert.equal(envProvider?.value, "${option:ai-provider}");
  assert.equal(envApiKey?.op, "upsert-env");
  assert.equal(envApiKey?.key, "${option:ai-config-prefix}_AI_API_KEY");
  assert.equal(envApiKey?.value, "${option:ai-api-key}");
  assert.equal(envBaseUrl?.op, "upsert-env");
  assert.equal(envBaseUrl?.key, "${option:ai-config-prefix}_AI_BASE_URL");
  assert.equal(envBaseUrl?.value, "${option:ai-base-url}");
  assert.equal(envTimeout?.op, "upsert-env");
  assert.equal(envTimeout?.key, "${option:ai-config-prefix}_AI_TIMEOUT_MS");
  assert.equal(envTimeout?.value, "${option:ai-timeout-ms}");
});
