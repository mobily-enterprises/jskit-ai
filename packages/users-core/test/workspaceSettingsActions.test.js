import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceActionContributor } from "../src/server/actions/workspaceActionContributor.js";
import { createWorkspaceSettingsActionContributor } from "../src/server/actions/workspaceSettingsActions.js";

function createSurfaceRuntimeDouble() {
  return {
    listEnabledSurfaceIds() {
      return ["app", "admin", "console"];
    },
    listWorkspaceSurfaceIds() {
      return ["app", "admin"];
    }
  };
}

function createWorkspaceAdminServiceDouble() {
  return {
    getRoleCatalog() {
      return {};
    },
    getWorkspaceSettings() {
      return {};
    },
    updateWorkspaceSettings() {
      return {};
    },
    listMembers() {
      return {};
    },
    updateMemberRole() {
      return {};
    },
    listInvites() {
      return {};
    },
    createInvite() {
      return {};
    },
    revokeInvite() {
      return {};
    },
    respondToPendingInviteByToken() {
      return {};
    }
  };
}

function createWorkspaceServiceDouble() {
  return {
    buildBootstrapPayload() {
      return {};
    },
    listWorkspacesForUser() {
      return [];
    },
    listPendingInvitesForUser() {
      return [];
    }
  };
}

test("workspace settings actions live in their own contributor", () => {
  const contributor = createWorkspaceSettingsActionContributor({
    workspaceAdminService: createWorkspaceAdminServiceDouble(),
    surfaceRuntime: createSurfaceRuntimeDouble()
  });

  assert.equal(contributor.contributorId, "users.workspace-settings");
  assert.equal(contributor.domain, "workspace-settings");
  assert.deepEqual(
    contributor.actions.map((action) => action.id),
    ["workspace.settings.read", "workspace.settings.update"]
  );
  assert.deepEqual(contributor.actions[0].surfaces, ["app", "admin"]);
  assert.deepEqual(contributor.actions[1].channels, ["api", "assistant_tool", "internal"]);
  assert.ok(contributor.actions[1].assistantTool?.inputJsonSchema);
});

test("workspace contributor no longer owns workspace settings actions", () => {
  const contributor = createWorkspaceActionContributor({
    workspaceService: createWorkspaceServiceDouble(),
    workspaceAdminService: createWorkspaceAdminServiceDouble(),
    surfaceRuntime: createSurfaceRuntimeDouble()
  });

  assert.equal(
    contributor.actions.some((action) => action.id === "workspace.settings.read"),
    false
  );
  assert.equal(
    contributor.actions.some((action) => action.id === "workspace.settings.update"),
    false
  );
});
