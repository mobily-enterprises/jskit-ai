import assert from "node:assert/strict";
import test from "node:test";
import { workspaceBootstrapActions } from "../src/server/workspaceBootstrap/workspaceBootstrapActions.js";
import { workspaceDirectoryActions } from "../src/server/workspaceDirectory/workspaceDirectoryActions.js";
import { workspacePendingInvitationsActions } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { workspaceMembersActions } from "../src/server/workspaceMembers/workspaceMembersActions.js";
import { workspaceSettingsActions } from "../src/server/workspaceSettings/workspaceSettingsActions.js";

test("workspace settings actions live in their own action array", () => {
  assert.deepEqual(
    workspaceSettingsActions.map((action) => action.id),
    ["workspace.settings.read", "workspace.settings.update"]
  );
  assert.equal(workspaceSettingsActions[0].surfacesFrom, "workspace");
  assert.equal(workspaceSettingsActions[1].surfacesFrom, "workspace");
  assert.deepEqual(workspaceSettingsActions[1].channels, ["api", "assistant_tool", "internal"]);
  assert.ok(workspaceSettingsActions[1].assistantTool?.input);
});

test("workspace actions array no longer owns workspace settings actions", () => {
  const otherWorkspaceActionIds = [
    ...workspaceBootstrapActions,
    ...workspaceDirectoryActions,
    ...workspacePendingInvitationsActions,
    ...workspaceMembersActions
  ].map((action) => action.id);

  assert.equal(
    otherWorkspaceActionIds.includes("workspace.settings.read"),
    false
  );
  assert.equal(
    otherWorkspaceActionIds.includes("workspace.settings.update"),
    false
  );
});
