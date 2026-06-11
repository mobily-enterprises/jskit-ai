import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

async function readClientSource(relativePath) {
  return readFile(path.join(PACKAGE_DIR, "src", "client", relativePath), "utf8");
}

test("users-web reports load errors as local resource-load intent by default", async () => {
  const source = await readClientSource("composables/runtime/operationUiHelpers.js");

  assert.match(source, /loadChannel = ""/);
  assert.match(source, /notFoundChannel = ""/);
  assert.match(source, /intent = "resource-load"/);
  assert.match(source, /intent: "resource-load"/);
  assert.doesNotMatch(source, /loadChannel = "banner"/);
});

test("users-web action feedback lets shell policy choose snackbar presentation", async () => {
  const source = await readClientSource("composables/runtime/useUiFeedback.js");

  assert.match(source, /successChannel = ""/);
  assert.match(source, /errorChannel = ""/);
  assert.match(source, /intent: "action-feedback"/);
  assert.doesNotMatch(source, /errorChannel = "banner"/);
});
