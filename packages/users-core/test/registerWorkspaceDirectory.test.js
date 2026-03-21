import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceDirectory } from "../src/server/workspaceDirectory/registerWorkspaceDirectory.js";

function createAppDouble() {
  const actionBatches = [];

  return {
    actionBatches,
    singleton() {},
    actions(entries) {
      actionBatches.push(Array.isArray(entries) ? entries : [entries]);
    }
  };
}

function listActionIds(app) {
  return app.actionBatches.flat().map((entry) => String(entry?.id || ""));
}

test("registerWorkspaceDirectory registers workspace directory actions without resolving runtime tenancy tokens", () => {
  const app = createAppDouble();

  registerWorkspaceDirectory(app);
  assert.deepEqual(listActionIds(app), ["workspace.workspaces.create", "workspace.workspaces.list"]);
});
