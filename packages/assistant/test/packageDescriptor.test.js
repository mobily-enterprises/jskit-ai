import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

test("assistant descriptor exposes generator options for runtime surface, settings surface, and config scope", () => {
  assert.equal(descriptor.kind, "generator");
  assert.equal(descriptor.metadata?.generatorPrimarySubcommand, "install");
  assert.equal(descriptor.options?.["runtime-surface"]?.required, true);
  assert.equal(descriptor.options?.["settings-surface"]?.required, true);
  assert.equal(descriptor.options?.["config-scope"]?.defaultValue, "global");
});

test("assistant descriptor publishes install examples for the supported runtime/settings shapes", () => {
  const installMetadata = descriptor.metadata?.generatorSubcommands?.install || {};
  const examples = Array.isArray(installMetadata.examples) ? installMetadata.examples : [];
  const labels = examples.map((entry) => String(entry?.label || ""));

  assert.equal(examples.length, 4);
  assert.deepEqual(labels, [
    "App runtime, console settings, global config",
    "App runtime, app settings, global config",
    "Workspace runtime, console settings, global config",
    "Workspace runtime, workspace settings, workspace config"
  ]);
});

test("assistant descriptor installs generated local runtime files instead of shipping a framework runtime", () => {
  const runtimePage = findFileMutation("assistant-page-runtime");
  const localPackageDescriptor = findFileMutation("assistant-local-package-descriptor");
  const configMigration = findFileMutation("assistant-config-initial-schema");
  const transcriptMigration = findFileMutation("assistant-transcripts-initial-schema");

  assert.equal(runtimePage?.toSurface, "${option:runtime-surface|lower}");
  assert.equal(runtimePage?.toSurfacePath, "assistant/index.vue");
  assert.equal(localPackageDescriptor?.to, "packages/assistant/package.descriptor.mjs");
  assert.equal(configMigration?.from, "templates/migrations/assistant_config_initial.cjs");
  assert.equal(transcriptMigration?.from, "templates/migrations/assistant_transcripts_initial.cjs");
});

test("assistant descriptor targets runtime and settings placements through explicit surface options", () => {
  const menuPlacement = findTextMutation("assistant-placement-menu");
  const settingsPlacement = findTextMutation("assistant-settings-form-placement");

  assert.match(String(menuPlacement?.value || ""), /surfaces: \["\$\{option:runtime-surface\|lower\}"\]/);
  assert.match(String(menuPlacement?.value || ""), /workspaceSuffix: "__ASSISTANT_MENU_WORKSPACE_SUFFIX__"/);
  assert.match(String(menuPlacement?.value || ""), /nonWorkspaceSuffix: "__ASSISTANT_MENU_NON_WORKSPACE_SUFFIX__"/);
  assert.match(String(settingsPlacement?.value || ""), /host: "__ASSISTANT_SETTINGS_HOST__"/);
  assert.match(String(settingsPlacement?.value || ""), /surfaces: \["\$\{option:settings-surface\|lower\}"\]/);
  assert.match(String(settingsPlacement?.value || ""), /componentToken: "assistant.web.settings.element"/);
});

test("assistant descriptor runtime deps use assistant-core and avoid workspace package coupling", () => {
  const runtimeDeps = descriptor?.mutations?.dependencies?.runtime || {};
  const assistantCorePackageJsonPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "assistant-core",
    "package.json"
  );

  return readFile(assistantCorePackageJsonPath, "utf8").then((source) => {
    const assistantCorePackageJson = JSON.parse(source);

    assert.equal(runtimeDeps["@local/assistant"], "file:packages/assistant");
    assert.equal(runtimeDeps["@jskit-ai/assistant-core"], assistantCorePackageJson.version);
    assert.equal(Object.hasOwn(runtimeDeps, "@jskit-ai/workspaces-core"), false);
    assert.equal(Object.hasOwn(runtimeDeps, "@jskit-ai/workspaces-web"), false);
  });
});
