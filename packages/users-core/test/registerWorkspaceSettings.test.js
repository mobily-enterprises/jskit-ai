import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceSettings } from "../src/server/workspaceSettings/registerWorkspaceSettings.js";
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from "../src/shared/events/usersEvents.js";

test("registerWorkspaceSettings registers workspace settings service realtime event metadata", () => {
  const singletonBindings = new Map();
  const actionCalls = [];
  const serviceCalls = [];

  const app = {
    singleton(token, factory) {
      singletonBindings.set(token, factory);
      return this;
    },
    service(token, factory, metadata) {
      serviceCalls.push({
        token,
        factory,
        metadata
      });
      return this;
    },
    actions(definitions) {
      actionCalls.push(definitions);
      return this;
    }
  };

  registerWorkspaceSettings(app);

  assert.equal(singletonBindings.has("workspaceSettingsRepository"), true);
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0].token, "users.workspace.settings.service");
  assert.equal(typeof serviceCalls[0].factory, "function");
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[0]?.realtime?.event, WORKSPACE_SETTINGS_CHANGED_EVENT);
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[0]?.realtime?.audience, "all_workspace_users");
  assert.equal(actionCalls.length, 1);
});
