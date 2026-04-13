import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = path.resolve(TEST_DIRECTORY, "../src/client/views/AuthProfileMenuLinkItem.vue");

test("AuthProfileMenuLinkItem delegates generic menu-link rendering to shell-web and passes disabled through explicitly", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");

  assert.match(source, /import ShellMenuLinkItem from "@jskit-ai\/shell-web\/client\/components\/ShellMenuLinkItem"/);
  assert.match(source, /disabled:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/s);
  assert.match(source, /<ShellMenuLinkItem[\s\S]*:to="resolvedTo"[\s\S]*:disabled="props\.disabled"/);
  assert.doesNotMatch(source, /<v-list-item\b/);
});
