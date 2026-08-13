import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell navigation blocker uses one Material alert dialog with safe actions", async () => {
  const dialogSource = await readFile(
    path.join(PACKAGE_ROOT, "src/client/components/ShellNavigationGuardDialog.vue"),
    "utf8"
  );
  const layoutSource = await readFile(
    path.join(PACKAGE_ROOT, "src/client/components/ShellLayout.vue"),
    "utf8"
  );

  assert.match(dialogSource, /<v-dialog/);
  assert.match(dialogSource, /role="alertdialog"/);
  assert.match(dialogSource, /default: "Stay"/);
  assert.match(dialogSource, /default: "Discard changes"/);
  assert.match(dialogSource, /\{\{ stayLabel \}\}<\/v-btn>/);
  assert.match(dialogSource, /\{\{ discardLabel \}\}<\/v-btn>/);
  assert.match(dialogSource, /@keydown\.esc\.stop\.prevent="stay"/);
  assert.match(dialogSource, /navigation\.cancelBlockedNavigation\(\)/);
  assert.match(dialogSource, /navigation\.confirmBlockedNavigation\(\)/);
  assert.match(layoutSource, /<ShellNavigationGuardDialog/);
  assert.match(layoutSource, /navigationLabel\('stay', 'Stay'\)/);
});
