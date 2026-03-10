import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/workspaceSettings/workspaceSettingsService.js";

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
      invitesEnabled: true,
      features: {
        surfaceAccess: {
          app: {
            denyEmails: ["old@example.com"],
            denyUserIds: [7]
          }
        }
      }
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
        return {
          ...state.settings,
          features: {
            ...state.settings.features,
            surfaceAccess: {
              ...state.settings.features.surfaceAccess,
              app: {
                ...state.settings.features.surfaceAccess.app
              }
            }
          }
        };
      },
      async updateSettingsByWorkspaceId(workspaceId, patch) {
        assert.equal(Number(workspaceId), 7);
        state.settingsPatch = {
          ...patch,
          appDenyEmails: Array.isArray(patch.appDenyEmails) ? [...patch.appDenyEmails] : patch.appDenyEmails,
          appDenyUserIds: Array.isArray(patch.appDenyUserIds) ? [...patch.appDenyUserIds] : patch.appDenyUserIds
        };
        state.settings = {
          ...state.settings,
          ...(Object.hasOwn(patch, "invitesEnabled") ? { invitesEnabled: patch.invitesEnabled } : {}),
          features: {
            ...state.settings.features,
            surfaceAccess: {
              ...state.settings.features.surfaceAccess,
              app: {
                ...state.settings.features.surfaceAccess.app,
                ...(Object.hasOwn(patch, "appDenyEmails") ? { denyEmails: [...patch.appDenyEmails] } : {}),
                ...(Object.hasOwn(patch, "appDenyUserIds") ? { denyUserIds: [...patch.appDenyUserIds] } : {})
              }
            }
          }
        };
        return state.settings;
      }
    }
  });

  return { service, state };
}

test("workspaceSettingsService.getWorkspaceSettings always includes deny lists", async () => {
  const { service, state } = createFixture();

  const response = await service.getWorkspaceSettings(state.workspace);

  assert.deepEqual(response.settings, {
    invitesEnabled: true,
    appDenyEmails: ["old@example.com"],
    appDenyUserIds: [7]
  });
});

test("workspaceSettingsService.updateWorkspaceSettings delegates workspace and settings patches to the correct repositories", async () => {
  const { service, state } = createFixture();

  const response = await service.updateWorkspaceSettings(
    state.workspace,
    {
      name: "New Name",
      invitesEnabled: false,
      appDenyEmails: ["new@example.com"],
      appDenyUserIds: [3, 4]
    }
  );

  assert.deepEqual(state.workspacePatch, {
    name: "New Name"
  });
  assert.deepEqual(state.settingsPatch, {
    invitesEnabled: false,
    appDenyEmails: ["new@example.com"],
    appDenyUserIds: [3, 4]
  });
  assert.equal(response.workspace.name, "New Name");
  assert.deepEqual(response.settings, {
    invitesEnabled: false,
    appDenyEmails: ["new@example.com"],
    appDenyUserIds: [3, 4]
  });
});
