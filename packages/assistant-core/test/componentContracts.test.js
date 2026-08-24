import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = new URL("../", import.meta.url);

async function readPackageFile(relativePath) {
  return readFile(path.join(packageRoot.pathname, relativePath), "utf8");
}

test("AssistantClientElement unwraps viewer refs before reading avatar fields", async () => {
  const source = await readPackageFile("src/client/components/AssistantClientElement.vue");
  assert.match(source, /normalizeObject\(unref\(props\.viewer\)\)/);
});

test("AssistantClientElement keeps its responsive scroll ancestors height-bounded", async () => {
  const source = await readPackageFile("src/client/components/AssistantClientElement.vue");

  assert.match(source, /<v-row class="assistant-layout h-100 flex-grow-1 flex-nowrap my-0">/u);
  assert.match(source, /<v-col cols="12" md="8" class="assistant-main-col/u);
  assert.match(source, /<v-col cols="12" md="4" class="assistant-side-col d-none d-md-flex/u);
  assert.match(source, /class="d-md-none"/u);
  assert.match(source, /\.assistant-main-col,\s*\.assistant-side-col,[\s\S]*height: 100%;[\s\S]*max-height: 100%;/u);
  assert.match(source, /\.messages-panel \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow: auto;/u);
});
