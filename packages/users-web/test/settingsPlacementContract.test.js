import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function readSettingsOutlets() {
  const outlets = descriptor?.metadata?.ui?.placements?.outlets;
  return Array.isArray(outlets)
    ? outlets.filter((entry) => String(entry?.host || "").trim() === "console-settings")
    : [];
}

test("users-web console settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "console", "settings.vue"), "utf8");

  assert.match(source, /<ShellOutlet host="console-settings" position="primary-menu" \/>/);
});

test("users-web descriptor metadata advertises console settings outlets with standard positions", () => {
  const outlets = readSettingsOutlets();
  assert.deepEqual(
    outlets,
    [
      {
        host: "console-settings",
        position: "primary-menu",
        surfaces: ["console"],
        source: "templates/src/pages/console/settings.vue"
      }
    ]
  );
});
