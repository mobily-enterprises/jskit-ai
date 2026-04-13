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
    ? outlets.filter((entry) => String(entry?.target || "").trim() === "admin-settings:primary-menu")
    : [];
}

function findContribution(id) {
  const contributions = descriptor?.metadata?.ui?.placements?.contributions;
  return Array.isArray(contributions)
    ? contributions.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findFileMutation(id) {
  const fileMutations = descriptor?.mutations?.files;
  return Array.isArray(fileMutations)
    ? fileMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("workspaces-web admin settings template exposes surface-derived settings outlets", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "admin", "workspace", "settings.vue"),
    "utf8"
  );

  assert.match(source, /target="admin-settings:primary-menu"/);
  assert.match(source, /default-link-component-token="local\.main\.ui\.surface-aware-menu-link-item"/);
  assert.match(source, /<RouterView \/>/);
});

test("workspaces-web admin settings index template is a simple developer-owned stub", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "src", "pages", "admin", "workspace", "settings", "index.vue"),
    "utf8"
  );

  assert.match(source, /definePage/);
  assert.match(source, /your_child_segment/);
});

test("workspaces-web descriptor metadata advertises admin settings outlets", () => {
  assert.deepEqual(
    readSettingsOutlets(),
    [
      {
        target: "admin-settings:primary-menu",
        defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
        surfaces: ["admin"],
        source: "templates/src/pages/admin/workspace/settings.vue"
      }
    ]
  );
  assert.equal(findContribution("users.workspace.settings.general"), null);
  assert.deepEqual(findFileMutation("users-web-page-admin-workspace-settings"), {
    from: "templates/src/pages/admin/workspace/settings/index.vue",
    toSurface: "admin",
    toSurfacePath: "workspace/settings/index.vue",
    reason: "Install workspace settings index stub scaffold for app-owned landing or redirect behavior.",
    category: "workspaces-web",
    id: "users-web-page-admin-workspace-settings",
    when: {
      config: "tenancyMode",
      in: ["personal", "workspaces"]
    }
  });
});
