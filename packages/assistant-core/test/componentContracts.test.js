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
