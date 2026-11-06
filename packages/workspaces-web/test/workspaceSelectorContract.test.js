import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");
const COMPONENT_PATH = path.join(PACKAGE_DIR, "src", "client", "components", "WorkspaceSelector.vue");

test("WorkspaceSelector passes workspaceSlug through generic page params", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");

  assert.match(
    source,
    /paths\.page\("\/",\s*\{\s*surface:\s*workspaceSwitchSurfaceId\.value,\s*params:\s*\{\s*workspaceSlug:\s*normalizedSlug\s*\}/s
  );
  assert.doesNotMatch(source, /workspaceSlug:\s*normalizedSlug,\s*mode:\s*"workspace"/s);
});

test("WorkspaceSelector activator keeps Material 3's 48dp touch target without a fixed height", async () => {
  const source = await readFile(COMPONENT_PATH, "utf8");

  assert.match(source, /class="users-workspace-selector__activator text-none"/);
  // material-web gives every default-size button a 48dp touch target around its 40dp body; a fixed height would
  // make the button itself taller than Material 3 draws it.
  assert.doesNotMatch(source, /min-height/u);
  assert.doesNotMatch(source, /<v-btn[^>]*users-workspace-selector__activator[^>]*\ssize=/u);
});
