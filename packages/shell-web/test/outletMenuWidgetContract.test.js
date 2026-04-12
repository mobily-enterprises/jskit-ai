import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("shell-web outlet menu widget exposes a configurable nested outlet", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "src", "client", "components", "ShellOutletMenuWidget.vue"),
    "utf8"
  );

  assert.match(source, /import \{ mdiCogOutline \} from "@mdi\/js";/);
  assert.match(source, /<ShellOutlet :host="props\.host" :position="props\.position" \/>/);
  assert.match(source, /default: mdiCogOutline/);
  assert.doesNotMatch(source, /mdi-[a-z0-9-]+/);
});

test("shell-web exports the outlet menu widget from both client index and package exports", async () => {
  const clientIndexSource = await readFile(path.join(PACKAGE_DIR, "src", "client", "index.js"), "utf8");
  assert.match(clientIndexSource, /export \{ default as ShellOutletMenuWidget \} from "\.\/components\/ShellOutletMenuWidget\.vue";/);

  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  assert.equal(
    packageJson?.exports?.["./client/components/ShellOutletMenuWidget"],
    "./src/client/components/ShellOutletMenuWidget.vue"
  );
});
