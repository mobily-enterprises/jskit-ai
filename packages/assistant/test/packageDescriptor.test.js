import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

function findTextMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.text) ? descriptor.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant descriptor exposes setup as the primary command and still depends on assistant-runtime", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.metadata?.generatorPrimarySubcommand, "setup");
  assert.equal(descriptor.options?.surface?.required, true);
  assert.equal(descriptor.options?.surface?.validationType, "enabled-surface-id");
  assert.equal(descriptor.options?.["settings-surface"]?.required, true);
  assert.equal(descriptor.options?.["settings-surface"]?.validationType, "enabled-surface-id");
  assert.equal(descriptor.options?.["config-scope"]?.defaultValue, "global");
  assert.equal(descriptor.options?.name?.required, false);
  assert.equal(descriptor.options?.["link-placement"]?.required, false);
  assert.deepEqual(descriptor.dependsOn, ["@jskit-ai/assistant-runtime"]);
});

test("assistant descriptor defines explicit page subcommands and setup-only mutations", () => {
  const subcommands = descriptor.metadata?.generatorSubcommands || {};
  const fileMutations = Array.isArray(descriptor?.mutations?.files) ? descriptor.mutations.files : [];

  assert.equal(subcommands.setup?.description?.length > 0, true);
  assert.equal(subcommands.page?.entrypoint, "src/server/subcommands/page.js");
  assert.equal(subcommands["settings-page"]?.entrypoint, "src/server/subcommands/settingsPage.js");
  assert.equal(subcommands.page?.positionalArgs?.[0]?.name, "target-file");
  assert.equal(subcommands["settings-page"]?.requiredOptionNames?.[0], "surface");
  assert.equal(subcommands.page?.optionNames?.includes("force"), true);
  assert.equal(subcommands["settings-page"]?.optionNames?.includes("force"), true);
  assert.equal(fileMutations.length, 0);
});

test("assistant descriptor appends only setup config and env entries", () => {
  const publicConfig = findTextMutation("assistant-public-surface-config");
  const serverConfig = findTextMutation("assistant-server-surface-config");
  const envBlock = findTextMutation("assistant-ai-prefixed-env");
  const textMutations = Array.isArray(descriptor?.mutations?.text) ? descriptor.mutations.text : [];

  assert.equal(textMutations.length, 3);
  assert.match(String(publicConfig?.value || ""), /config\.assistantSurfaces\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(publicConfig?.value || ""), /settingsSurfaceId: "__ASSISTANT_SETTINGS_SURFACE_ID__"/);
  assert.match(String(serverConfig?.value || ""), /config\.assistantServer\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(serverConfig?.value || ""), /aiConfigPrefix: "__ASSISTANT_AI_CONFIG_PREFIX__"/);
  assert.match(String(envBlock?.value || ""), /__ASSISTANT_AI_CONFIG_PREFIX___AI_PROVIDER=\$\{option:ai-provider\}/);
});
