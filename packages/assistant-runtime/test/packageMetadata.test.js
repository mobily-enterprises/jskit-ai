import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

function findTextMutation(id) {
  const mutations = Array.isArray(packageMetadata?.mutations?.text) ? packageMetadata.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

function findFileMutation(id) {
  const mutations = Array.isArray(packageMetadata?.mutations?.files) ? packageMetadata.mutations.files : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant-runtime packageMetadata registers runtime providers and initializes assistant config roots", () => {
  assert.equal(packageMetadata.kind, "runtime");
  assert.equal(packageJson.name, "@jskit-ai/assistant-runtime");
  assert.equal(packageMetadata.capabilities?.requires?.includes("workspaces.core"), false);
  assert.equal(packageMetadata.capabilities?.requires?.includes("workspaces.web"), false);
  assert.equal(packageMetadata.runtime?.server?.providers?.[0]?.entrypoint, "src/server/AssistantProvider.js");
  assert.equal(packageMetadata.runtime?.client?.providers?.[0]?.entrypoint, "src/client/providers/AssistantClientProvider.js");

  const publicInit = findTextMutation("assistant-runtime-public-surface-registry-init");
  const serverInit = findTextMutation("assistant-runtime-server-surface-registry-init");

  assert.match(String(publicInit?.value || ""), /config\.assistantSurfaces \|\|= \{\};/);
  assert.match(String(serverInit?.value || ""), /config\.assistantServer \|\|= \{\};/);
});

test("assistant-runtime packageMetadata ships common assistant migrations", () => {
  const configMigration = findFileMutation("assistant-runtime-config-initial-schema");
  const transcriptMigration = findFileMutation("assistant-runtime-transcripts-initial-schema");

  assert.equal(configMigration?.from, "templates/migrations/assistant_config_initial.cjs");
  assert.equal(transcriptMigration?.from, "templates/migrations/assistant_transcripts_initial.cjs");
});
