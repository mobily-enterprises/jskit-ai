import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

function findRoute(method, routePath) {
  const routes = descriptor?.metadata?.server?.routes;
  return Array.isArray(routes)
    ? routes.find((entry) => entry?.method === method && entry?.path === routePath) || null
    : null;
}

function findFileMutation(id) {
  const fileMutations = descriptor?.mutations?.files;
  return Array.isArray(fileMutations)
    ? fileMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

function findSourceMutation(id) {
  const sourceMutations = descriptor?.mutations?.source;
  return Array.isArray(sourceMutations)
    ? sourceMutations.find((entry) => String(entry?.id || "").trim() === id) || null
    : null;
}

test("workspaces-core descriptor advertises public invite resolution route metadata", () => {
  assert.deepEqual(findRoute("GET", "/api/workspace/invitations/resolve"), {
    method: "GET",
    path: "/api/workspace/invitations/resolve",
    summary: "Resolve safe public workspace invitation metadata."
  });
});

test("workspaces-core installs an app-owned editable workspace invite email template", async () => {
  const source = await readFile(
    path.join(PACKAGE_DIR, "templates", "packages", "main", "src", "server", "email", "workspaceInviteEmail.js"),
    "utf8"
  );

  assert.match(source, /function renderWorkspaceInviteEmail/);
  assert.match(source, /export \{ renderWorkspaceInviteEmail \}/);
  assert.match(source, /inviteUrl/);
  assert.deepEqual(findFileMutation("workspaces-core-main-workspace-invite-email-template"), {
    from: "templates/packages/main/src/server/email/workspaceInviteEmail.js",
    to: "packages/main/src/server/email/workspaceInviteEmail.js",
    ownership: "app",
    preserveOnRemove: true,
    reason: "Install app-owned editable workspace invite email template.",
    category: "workspaces-core",
    id: "workspaces-core-main-workspace-invite-email-template"
  });
  assert.deepEqual(findSourceMutation("workspaces-core-server-config-workspace-invite-email-import"), {
    op: "ensure-import",
    file: "config/server.js",
    namedImports: ["renderWorkspaceInviteEmail"],
    from: "../packages/main/src/server/email/workspaceInviteEmail.js",
    reason: "Load app-owned workspace invite email renderer from packages/main.",
    category: "workspaces-core",
    id: "workspaces-core-server-config-workspace-invite-email-import"
  });
  assert.deepEqual(findSourceMutation("workspaces-core-server-config-workspace-invite-email-template"), {
    op: "ensure-assignment",
    file: "config/server.js",
    target: "config.workspaceInviteEmailTemplate",
    value: "renderWorkspaceInviteEmail",
    reason: "Bind app-owned workspace invite email renderer into server config.",
    category: "workspaces-core",
    id: "workspaces-core-server-config-workspace-invite-email-template"
  });
});
