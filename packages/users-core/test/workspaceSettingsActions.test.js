import assert from "node:assert/strict";
import test from "node:test";
import { workspaceActions } from "../src/server/actions/workspaceActionContributor.js";
import { workspaceSettingsActions } from "../src/server/actions/workspaceSettingsActions.js";

test("workspace settings actions live in their own action array", () => {
  assert.deepEqual(
    workspaceSettingsActions.map((action) => action.id),
    ["workspace.settings.read", "workspace.settings.update"]
  );
  assert.equal(workspaceSettingsActions[0].surfacesFrom, "workspace");
  assert.equal(workspaceSettingsActions[1].surfacesFrom, "workspace");
  assert.deepEqual(workspaceSettingsActions[1].channels, ["api", "assistant_tool", "internal"]);
  assert.ok(workspaceSettingsActions[1].assistantTool?.inputJsonSchema);
});

test("workspace actions array no longer owns workspace settings actions", () => {
  assert.equal(
    workspaceActions.some((action) => action.id === "workspace.settings.read"),
    false
  );
  assert.equal(
    workspaceActions.some((action) => action.id === "workspace.settings.update"),
    false
  );
});
