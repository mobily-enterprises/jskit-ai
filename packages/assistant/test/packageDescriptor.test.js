import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

function findFileMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.files) ? descriptor.mutations.files : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

function findTextMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.text) ? descriptor.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant descriptor exposes per-surface generation options and depends on assistant-runtime", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.options?.surface?.required, true);
  assert.equal(descriptor.options?.["settings-surface"]?.required, true);
  assert.equal(descriptor.options?.["config-scope"]?.defaultValue, "global");
  assert.equal(descriptor.options?.["ai-config-prefix"]?.required, false);
  assert.deepEqual(descriptor.dependsOn, ["@jskit-ai/assistant-runtime"]);
});

test("assistant descriptor generates only assistant runtime/settings pages and no local runtime package", () => {
  const runtimePage = findFileMutation("assistant-page-runtime");
  const settingsPageStandard = findFileMutation("assistant-page-settings-standard");
  const settingsPageAdmin = findFileMutation("assistant-page-settings-admin");
  const fileMutations = Array.isArray(descriptor?.mutations?.files) ? descriptor.mutations.files : [];

  assert.equal(runtimePage?.toSurface, "${option:surface|lower}");
  assert.equal(runtimePage?.toSurfacePath, "assistant/index.vue");
  assert.equal(settingsPageStandard?.toSurfacePath, "settings/${option:settings-route-path|path}/index.vue");
  assert.equal(settingsPageAdmin?.toSurfacePath, "workspace/settings/${option:settings-route-path|path}/index.vue");
  assert.equal(fileMutations.length, 3);
});

test("assistant descriptor appends menu placement, settings menu placement, and per-surface config entries", () => {
  const menuPlacement = findTextMutation("assistant-placement-menu");
  const settingsPlacement = findTextMutation("assistant-settings-menu-placement");
  const publicConfig = findTextMutation("assistant-public-surface-config");
  const serverConfig = findTextMutation("assistant-server-surface-config");
  const envBlock = findTextMutation("assistant-ai-prefixed-env");

  assert.match(String(menuPlacement?.value || ""), /assistant\.generated\.menu:\$\{option:surface\|lower\}/);
  assert.match(String(menuPlacement?.value || ""), /surfaces: \["\$\{option:surface\|lower\}"\]/);
  assert.match(String(settingsPlacement?.value || ""), /assistant\.generated\.settings\.menu:\$\{option:surface\|lower\}/);
  assert.match(String(settingsPlacement?.value || ""), /host: "__ASSISTANT_SETTINGS_HOST__"/);
  assert.match(String(settingsPlacement?.value || ""), /position: "primary-menu"/);
  assert.match(String(publicConfig?.value || ""), /config\.assistantSurfaces\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(serverConfig?.value || ""), /config\.assistantServer\.\$\{option:surface\|lower\} = \{/);
  assert.match(String(serverConfig?.value || ""), /aiConfigPrefix: "__ASSISTANT_AI_CONFIG_PREFIX__"/);
  assert.match(String(envBlock?.value || ""), /__ASSISTANT_AI_CONFIG_PREFIX___AI_PROVIDER=\$\{option:ai-provider\}/);
});
