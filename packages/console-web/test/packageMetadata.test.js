import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("console-web publishes a pattern-owned console surface without source mutations", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/console-surface/PATTERN.md"), "utf8");
  const page = await readFile(path.join(packageRoot, "patterns/console-surface/example/src/pages/console.vue"), "utf8");
  const settings = await readFile(
    path.join(packageRoot, "patterns/console-surface/example/src/pages/console/settings.vue"),
    "utf8"
  );

  assert.equal(packageJson.jskit.mutations, undefined);
  assert.match(pattern, /semantic navigation/u);
  assert.match(pattern, /Loading screens use skeletons/u);
  assert.match(page, /ShellLayout/u);
  assert.match(settings, /console-settings:primary-menu/u);
});

test("console-web metadata describes its semantic settings outlet", () => {
  const outlets = packageJson.jskit.metadata.ui.placements.outlets;
  assert.deepEqual(outlets, [{
    target: "console-settings:primary-menu",
    surfaces: ["console"],
    source: "patterns/console-surface/example/src/pages/console/settings.vue"
  }]);
});
