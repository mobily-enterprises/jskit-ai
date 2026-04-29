import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceThemePalettes } from "@jskit-ai/workspaces-core/shared/settings";
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
  const defaultTheme = resolveWorkspaceThemePalettes({
    lightPrimaryColor: "#0F6B54"
  });
  const state = {
    settingsPatch: null,
    workspace: {
      id: 7,
      slug: "tonymobily3",
      name: "TonyMobily3",
      ownerUserId: 9
    },
    settings: {
      lightPrimaryColor: defaultTheme.light.color,
      lightSecondaryColor: defaultTheme.light.secondaryColor,
      lightSurfaceColor: defaultTheme.light.surfaceColor,
      lightSurfaceVariantColor: defaultTheme.light.surfaceVariantColor,
      darkPrimaryColor: defaultTheme.dark.color,
      darkSecondaryColor: defaultTheme.dark.secondaryColor,
      darkSurfaceColor: defaultTheme.dark.surfaceColor,
      darkSurfaceVariantColor: defaultTheme.dark.surfaceVariantColor,
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
    lightPrimaryColor: "#0F6B54",
    lightSecondaryColor: "#48A9A6",
    lightSurfaceColor: "#FFFFFF",
    lightSurfaceVariantColor: "#424242",
    darkPrimaryColor: "#2196F3",
    darkSecondaryColor: "#54B6B2",
    darkSurfaceColor: "#212121",
    darkSurfaceVariantColor: "#C8C8C8",
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
      invitesEnabled: false
    },
    authorizedOptions(["workspace.settings.update"])
  );

  assert.deepEqual(state.settingsPatch, {
    invitesEnabled: false
  });
  assert.deepEqual(response.settings, {
    lightPrimaryColor: "#0F6B54",
    lightSecondaryColor: "#48A9A6",
    lightSurfaceColor: "#FFFFFF",
    lightSurfaceVariantColor: "#424242",
    darkPrimaryColor: "#2196F3",
    darkSecondaryColor: "#54B6B2",
    darkSurfaceColor: "#212121",
    darkSurfaceVariantColor: "#C8C8C8",
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
    lightPrimaryColor: "#0F6B54",
    lightSecondaryColor: "#48A9A6",
    lightSurfaceColor: "#FFFFFF",
    lightSurfaceVariantColor: "#424242",
    darkPrimaryColor: "#2196F3",
    darkSecondaryColor: "#54B6B2",
    darkSurfaceColor: "#212121",
    darkSurfaceVariantColor: "#C8C8C8",
    invitesEnabled: false,
    invitesAvailable: false,
    invitesEffective: false
  });
});
