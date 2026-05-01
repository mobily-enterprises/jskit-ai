import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(workspaceSettingsActions[1].channels, ["api", "assistant_tool", "automation", "internal"]);
  assert.equal(workspaceSettingsActions[1].extensions?.assistant?.description, "Update workspace settings.");
});

test("workspace actions array no longer owns workspace settings actions", () => {
  const otherWorkspaceActionIds = [
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

test("workspace directory actions stay thin and defer output validation to routes", () => {
  const listAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.list");
  assert.ok(listAction);
  assert.equal(listAction.output, null);
});

test("workspace directory read/update actions stay thin and defer output validation to routes", () => {
  const readAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.read");
  const updateAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.update");

  assert.ok(readAction);
  assert.ok(updateAction);
  assert.equal(readAction.output, null);
  assert.equal(updateAction.output, null);
});
