import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

function findTextMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.text) ? descriptor.mutations.text : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

function findFileMutation(id) {
  const mutations = Array.isArray(descriptor?.mutations?.files) ? descriptor.mutations.files : [];
  return mutations.find((entry) => String(entry?.id || "") === id) || null;
}

test("assistant-runtime descriptor registers runtime providers and initializes assistant config roots", () => {
  assert.equal(descriptor.kind, "runtime");
  assert.equal(descriptor.packageId, "@jskit-ai/assistant-runtime");
  assert.equal(descriptor.runtime?.server?.providers?.[0]?.entrypoint, "src/server/AssistantProvider.js");
  assert.equal(descriptor.runtime?.client?.providers?.[0]?.entrypoint, "src/client/providers/AssistantClientProvider.js");

  const publicInit = findTextMutation("assistant-runtime-public-surface-registry-init");
  const serverInit = findTextMutation("assistant-runtime-server-surface-registry-init");

  assert.match(String(publicInit?.value || ""), /config\.assistantSurfaces \|\|= \{\};/);
  assert.match(String(serverInit?.value || ""), /config\.assistantServer \|\|= \{\};/);
});

test("assistant-runtime descriptor ships common assistant migrations", () => {
  const configMigration = findFileMutation("assistant-runtime-config-initial-schema");
  const transcriptMigration = findFileMutation("assistant-runtime-transcripts-initial-schema");

  assert.equal(configMigration?.from, "templates/migrations/assistant_config_initial.cjs");
  assert.equal(transcriptMigration?.from, "templates/migrations/assistant_transcripts_initial.cjs");
});
