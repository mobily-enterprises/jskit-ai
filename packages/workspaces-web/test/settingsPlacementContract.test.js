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
    ? outlets.filter((entry) => String(entry?.host || "").trim() === "admin-settings")
    : [];
}

function findContribution(id) {
  const contributions = descriptor?.metadata?.ui?.placements?.contributions;
  return Array.isArray(contributions)
    ? contributions.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("workspaces-web admin settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "admin", "workspace", "settings", "index.vue"),
    "utf8"
  );

  assert.match(source, /<ShellOutlet host="admin-settings" position="primary-menu" \/>/);
  assert.match(source, /<ShellOutlet host="admin-settings" position="forms" \/>/);
});

test("workspaces-web descriptor metadata advertises admin settings outlets and form placement on the derived host", () => {
  assert.deepEqual(
    readSettingsOutlets(),
    [
      {
        host: "admin-settings",
        position: "primary-menu",
        surfaces: ["admin"],
        source: "templates/src/pages/admin/workspace/settings/index.vue"
      },
      {
        host: "admin-settings",
        position: "forms",
        surfaces: ["admin"],
        source: "templates/src/pages/admin/workspace/settings/index.vue"
      }
    ]
  );

  assert.deepEqual(findContribution("users.workspace.settings.form"), {
    id: "users.workspace.settings.form",
    host: "admin-settings",
    position: "forms",
    surfaces: ["admin"],
    order: 100,
    componentToken: "users.web.workspace-settings.element",
    source: "mutations.text#users-web-workspace-settings-form-placement"
  });
});
