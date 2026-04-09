import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function readTemplateFile(relativePath) {
  return readFile(path.join(packageRoot, relativePath), "utf8");
}

test("assistant page template renders the shared runtime client element with an explicit surface id", async () => {
  const source = await readTemplateFile("templates/src/pages/assistant/index.vue");

  assert.match(source, /<AssistantSurfaceClientElement surface-id="__ASSISTANT_SURFACE_ID__" \/>/);
  assert.match(source, /from "@jskit-ai\/assistant-runtime\/client"/);
});

test("assistant settings page template renders the shared runtime settings client element with the target surface id", async () => {
  const source = await readTemplateFile("templates/src/pages/settings/assistant/index.vue");

  assert.match(source, /<AssistantSettingsClientElement target-surface-id="__ASSISTANT_SURFACE_ID__" \/>/);
  assert.match(source, /from "@jskit-ai\/assistant-runtime\/client"/);
});
