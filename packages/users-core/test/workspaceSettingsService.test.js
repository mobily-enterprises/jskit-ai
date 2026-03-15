import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/workspaceSettings/workspaceSettingsService.js";

function authorizedOptions(permissions = []) {
  return {
    context: {
      actor: {
        id: 1
      },
      permissions
    }
  };
}

function createFixture() {
  const state = {
    workspacePatch: null,
    settingsPatch: null,
    workspace: {
      id: 7,
      slug: "tonymobily3",
      name: "TonyMobily3",
      ownerUserId: 9,
      avatarUrl: "",
      color: "#0F6B54"
    },
    settings: {
      invitesEnabled: true
    }
  };

  const service = createService({
    workspacesRepository: {
      async findById(id) {
        return Number(id) === 7 ? { ...state.workspace } : null;
      },
      async updateById(workspaceId, patch) {
        assert.equal(Number(workspaceId), 7);
        state.workspacePatch = { ...patch };
        state.workspace = {
          ...state.workspace,
          ...patch
        };
        return { ...state.workspace };
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId(workspaceId) {
        assert.equal(Number(workspaceId), 7);
        return { ...state.settings };
      },
      async updateSettingsByWorkspaceId(workspaceId, patch) {
        assert.equal(Number(workspaceId), 7);
        state.settingsPatch = { ...patch };
        state.settings = {
          ...state.settings,
          ...(Object.hasOwn(patch, "invitesEnabled") ? { invitesEnabled: patch.invitesEnabled } : {})
        };
        return state.settings;
      }
    }
  });

  return { service, state };
}

test("workspaceSettingsService.getWorkspaceSettings returns the stored invitesEnabled flag", async () => {
  const { service, state } = createFixture();

  const response = await service.getWorkspaceSettings(
    state.workspace,
    authorizedOptions(["workspace.settings.view"])
  );

  assert.deepEqual(response.settings, {
    invitesEnabled: true
  });
});

test("workspaceSettingsService.updateWorkspaceSettings delegates workspace and settings patches to the correct repositories", async () => {
  const { service, state } = createFixture();

  const response = await service.updateWorkspaceSettings(
    state.workspace,
    {
      name: "New Name",
      invitesEnabled: false
    },
    authorizedOptions(["workspace.settings.update"])
  );

  assert.deepEqual(state.workspacePatch, {
    name: "New Name"
  });
  assert.deepEqual(state.settingsPatch, {
    invitesEnabled: false
  });
  assert.equal(response.workspace.name, "New Name");
  assert.deepEqual(response.settings, {
    invitesEnabled: false
  });
});
