import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceSettings } from "../src/server/workspaceSettings/registerWorkspaceSettings.js";

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
  assert.equal(serviceCalls[0].token, "workspaces.settings.service");
  assert.equal(typeof serviceCalls[0].factory, "function");
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[0]?.realtime?.event, "workspace.settings.changed");
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[0]?.realtime?.audience, "event_scope");
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(serviceCalls[0].metadata?.events?.updateWorkspaceSettings?.[1]?.realtime?.audience, "event_scope");
  assert.equal(actionCalls.length, 1);
});
