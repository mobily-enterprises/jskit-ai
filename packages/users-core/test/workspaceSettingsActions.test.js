import assert from "node:assert/strict";
import test from "node:test";
import "../test-support/registerDefaultSettingsFields.js";
import { workspaceDirectoryActions } from "../src/server/workspaceDirectory/workspaceDirectoryActions.js";
import { workspacePendingInvitationsActions } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { workspaceMembersActions } from "../src/server/workspaceMembers/workspaceMembersActions.js";
import { workspaceSettingsActions } from "../src/server/workspaceSettings/workspaceSettingsActions.js";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";

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

test("workspace directory actions use the canonical workspace list resource output", () => {
  const listAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.list");
  assert.ok(listAction);
  assert.equal(listAction.outputValidator, workspaceResource.operations.list.outputValidator);
});

test("workspace directory read/update actions use canonical workspace resource validators", () => {
  const readAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.read");
  const updateAction = workspaceDirectoryActions.find((action) => action.id === "workspace.workspaces.update");

  assert.ok(readAction);
  assert.ok(updateAction);
  assert.equal(readAction.outputValidator, workspaceResource.operations.view.outputValidator);
  assert.equal(updateAction.outputValidator, workspaceResource.operations.patch.outputValidator);
});
