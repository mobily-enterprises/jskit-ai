import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Every module this process loads, in order: the browser catalog must not pull in the whole AI model snapshot.
const loaded = [];
registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
const loads = (file) => loaded.some((url) => url.endsWith(`/src/shared/${file}`));

test("the browser catalog carries the configurable AI providers without the framework-metadata snapshot", async () => {
  const shared = await import("../src/shared/english-definitions.js");
  assert.ok(shared.connectorDefinitions.some((definition) => definition.id === "ai"));
  assert.ok(shared.aiDefinition.settingsFields[0].items.length > 0);
  assert.equal(loads("ai-models.json"), true);
  assert.equal(loads("ai-framework-models.json"), false);

  // The whole catalogue (./shared/ai) still loads both files and sees every provider.
  const { aiCatalogue } = await import("../src/shared/english-ai.js");
  assert.equal(loads("ai-framework-models.json"), true);
  assert.equal(aiCatalogue.providers.length, 213);
});
