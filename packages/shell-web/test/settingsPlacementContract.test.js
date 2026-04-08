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
    ? outlets.filter((entry) => String(entry?.host || "").trim() === "home-settings")
    : [];
}

function findFileMutation(id) {
  const files = descriptor?.mutations?.files;
  return Array.isArray(files)
    ? files.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("shell-web home settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "settings", "index.vue"), "utf8");

  assert.match(source, /<ShellOutlet host="home-settings" position="primary-menu" \/>/);
  assert.match(source, /<ShellOutlet host="home-settings" position="forms" \/>/);
});

test("shell-web descriptor metadata advertises home settings outlets and installs the scaffold page", () => {
  assert.deepEqual(
    readSettingsOutlets(),
    [
      {
        host: "home-settings",
        position: "primary-menu",
        surfaces: ["home"],
        source: "templates/src/pages/home/settings/index.vue"
      },
      {
        host: "home-settings",
        position: "forms",
        surfaces: ["home"],
        source: "templates/src/pages/home/settings/index.vue"
      }
    ]
  );

  assert.deepEqual(findFileMutation("shell-web-page-home-settings"), {
    from: "templates/src/pages/home/settings/index.vue",
    toSurface: "home",
    toSurfacePath: "settings/index.vue",
    reason: "Install shell-driven home settings page scaffold with surface-derived settings outlets.",
    category: "shell-web",
    id: "shell-web-page-home-settings"
  });
});

test("shell-web home starter page links to the home settings scaffold", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "templates", "src", "pages", "home", "index.vue"), "utf8");

  assert.match(source, /to="\/home\/settings"/);
});
