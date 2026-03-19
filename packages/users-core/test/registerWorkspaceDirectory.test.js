import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceDirectory } from "../src/server/workspaceDirectory/registerWorkspaceDirectory.js";

function createAppDouble({ workspaceSelfCreateEnabled = false } = {}) {
  const actionBatches = [];

  return {
    actionBatches,
    singleton() {},
    actions(entries) {
      actionBatches.push(Array.isArray(entries) ? entries : [entries]);
    },
    make(token) {
      if (token === "users.workspace.self-create.enabled") {
        return workspaceSelfCreateEnabled;
      }
      throw new Error(`Unknown token ${String(token)}`);
    }
  };
}

function listActionIds(app) {
  return app.actionBatches.flat().map((entry) => String(entry?.id || ""));
}

test("registerWorkspaceDirectory omits workspace create action when self-create is disabled", () => {
  const app = createAppDouble({
    workspaceSelfCreateEnabled: false
  });

  registerWorkspaceDirectory(app);
  assert.deepEqual(listActionIds(app), ["workspace.workspaces.list"]);
});

test("registerWorkspaceDirectory includes workspace create action when self-create is enabled", () => {
  const app = createAppDouble({
    workspaceSelfCreateEnabled: true
  });

  registerWorkspaceDirectory(app);
  assert.deepEqual(listActionIds(app), ["workspace.workspaces.create", "workspace.workspaces.list"]);
});
