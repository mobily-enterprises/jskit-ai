import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function findRoute(method, routePath) {
  const routes = packageMetadata?.metadata?.server?.routes;
  return Array.isArray(routes)
    ? routes.find((entry) => entry?.method === method && entry?.path === routePath) || null
    : null;
}

test("workspaces-core packageMetadata advertises public invite resolution route metadata", () => {
  assert.deepEqual(findRoute("GET", "/api/workspace/invitations/resolve"), {
    method: "GET",
    path: "/api/workspace/invitations/resolve",
    summary: "Resolve safe public workspace invitation metadata."
  });
});

test("workspaces-core publishes an app-owned editable role catalog pattern", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "patterns", "workspace-server", "example", "config", "roles.js"),
    "utf8"
  );

  assert.match(source, /export const roleCatalog/);
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
});

test("workspaces-core publishes an app-owned editable workspace invite email pattern", async () => {
  const source = await readFile(
    path.join(
      PACKAGE_DIR,
      "patterns",
      "workspace-server",
      "example",
      "packages",
      "main",
      "src",
      "server",
      "email",
      "workspaceInviteEmail.js"
    ),
    "utf8"
  );

  assert.match(source, /function renderWorkspaceInviteEmail/);
  assert.match(source, /export \{ renderWorkspaceInviteEmail \}/);
  assert.match(source, /inviteUrl/);
  assert.deepEqual(packageMetadata.migrations, { directories: ["migrations"] });
});
