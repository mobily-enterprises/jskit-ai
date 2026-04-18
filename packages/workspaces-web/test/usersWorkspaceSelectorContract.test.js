import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");
const COMPONENT_PATH = path.join(PACKAGE_DIR, "src", "client", "components", "UsersWorkspaceSelector.vue");

test("UsersWorkspaceSelector passes workspaceSlug through generic page params", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");

  assert.match(
    source,
    /paths\.page\("\/",\s*\{\s*surface:\s*workspaceSwitchSurfaceId\.value,\s*params:\s*\{\s*workspaceSlug:\s*normalizedSlug\s*\}/s
  );
  assert.doesNotMatch(source, /workspaceSlug:\s*normalizedSlug,\s*mode:\s*"workspace"/s);
});
