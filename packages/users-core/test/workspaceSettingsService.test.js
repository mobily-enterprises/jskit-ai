import assert from "node:assert/strict";
import test from "node:test";
import "../test-support/registerDefaultSettingsFields.js";
import { resolveWorkspaceThemePalette } from "../src/shared/settings.js";
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

function createFixture({ workspaceInvitationsEnabled = true } = {}) {
  const defaultTheme = resolveWorkspaceThemePalette({
    color: "#0F6B54"
  });
  const state = {
    settingsPatch: null,
    workspace: {
      id: 7,
      slug: "tonymobily3",
      name: "TonyMobily3",
      ownerUserId: 9,
      avatarUrl: "",
      color: defaultTheme.color
    },
    settings: {
      name: "TonyMobily3",
      avatarUrl: "",
      color: defaultTheme.color,
      secondaryColor: defaultTheme.secondaryColor,
      surfaceColor: defaultTheme.surfaceColor,
      surfaceVariantColor: defaultTheme.surfaceVariantColor,
      invitesEnabled: true
    }
  };

  const service = createService({
    workspaceInvitationsEnabled,
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
          ...patch
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
    name: "TonyMobily3",
    avatarUrl: "",
    color: "#0F6B54",
    secondaryColor: "#0B4D3C",
    surfaceColor: "#EEF5F3",
    surfaceVariantColor: "#DDEAE7",
    invitesEnabled: true,
    invitesAvailable: true,
    invitesEffective: true
  });
});

test("workspaceSettingsService.updateWorkspaceSettings writes editable fields through workspaceSettingsRepository only", async () => {
  const { service, state } = createFixture();

  const response = await service.updateWorkspaceSettings(
    state.workspace,
    {
      name: "New Name",
      invitesEnabled: false
    },
    authorizedOptions(["workspace.settings.update"])
  );

  assert.deepEqual(state.settingsPatch, {
    name: "New Name",
    invitesEnabled: false
  });
  assert.deepEqual(response.settings, {
    name: "New Name",
    avatarUrl: "",
    color: "#0F6B54",
    secondaryColor: "#0B4D3C",
    surfaceColor: "#EEF5F3",
    surfaceVariantColor: "#DDEAE7",
    invitesEnabled: false,
    invitesAvailable: true,
    invitesEffective: false
  });
});

test("workspaceSettingsService disables invite settings in output when app policy disables invitations", async () => {
  const { service, state } = createFixture({
    workspaceInvitationsEnabled: false
  });

  const response = await service.getWorkspaceSettings(
    state.workspace,
    authorizedOptions(["workspace.settings.view"])
  );

  assert.deepEqual(response.settings, {
    name: "TonyMobily3",
    avatarUrl: "",
    color: "#0F6B54",
    secondaryColor: "#0B4D3C",
    surfaceColor: "#EEF5F3",
    surfaceVariantColor: "#DDEAE7",
    invitesEnabled: false,
    invitesAvailable: false,
    invitesEffective: false
  });
});
