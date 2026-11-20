import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceThemePalettes } from "@jskit-ai/workspaces-core/shared/settings";
import { createService } from "../src/server/workspaceSettings/workspaceSettingsService.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

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

function createFixture({ workspaceInvitationsEnabled = true, workspaceInvitationsAnyAccount = false, invitesRequireSameEmail = false } = {}) {
  const defaultTheme = resolveWorkspaceThemePalettes({
    lightPrimaryColor: "#0F6B54"
  });
  const state = {
    settingsPatch: null,
    workspace: {
      id: 7,
      slug: "tony3",
      name: "Tony3",
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
      invitesEnabled: true,
      invitesRequireSameEmail
    }
  };

  const service = createService({
    workspaceInvitationsEnabled,
    workspaceInvitationsAnyAccount,
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
    },
    roleCatalog: createWorkspaceRoleCatalog()
  });

  return { service, state };
}

test("workspaceSettingsService.getWorkspaceSettings returns the stored invitesEnabled flag", async () => {
  const { service, state } = createFixture();

  const response = (await service.getWorkspaceSettings(
    state.workspace,
    authorizedOptions(["workspace.settings.view"])
  )).value;

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
    invitesEffective: true,
    invitesRequireSameEmail: true,
    invitesAnyAccountAvailable: false
  });
});

test("workspaceSettingsService.updateWorkspaceSettings writes editable fields through workspaceSettingsRepository only", async () => {
  const { service, state } = createFixture();

  const response = (await service.updateWorkspaceSettings(
    state.workspace,
    {
      invitesEnabled: false
    },
    authorizedOptions(["workspace.settings.update"])
  )).value;

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
    invitesEffective: false,
    invitesRequireSameEmail: true,
    invitesAnyAccountAvailable: false
  });
});

test("workspaceSettingsService disables invite settings in output when app policy disables invitations", async () => {
  const { service, state } = createFixture({
    workspaceInvitationsEnabled: false
  });

  const response = (await service.getWorkspaceSettings(
    state.workspace,
    authorizedOptions(["workspace.settings.view"])
  )).value;

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
    invitesEffective: false,
    invitesRequireSameEmail: true,
    invitesAnyAccountAvailable: false
  });
});

test("workspaceSettingsService answers and saves invitesRequireSameEmail where the app lets any account accept", async () => {
  const lenient = createFixture({ workspaceInvitationsAnyAccount: true });
  const read = (await lenient.service.getWorkspaceSettings(lenient.state.workspace, authorizedOptions())).value.settings;
  assert.deepEqual(
    { invitesRequireSameEmail: read.invitesRequireSameEmail, invitesAnyAccountAvailable: read.invitesAnyAccountAvailable },
    { invitesRequireSameEmail: false, invitesAnyAccountAvailable: true }
  );
  const saved = (await lenient.service.updateWorkspaceSettings(lenient.state.workspace, { invitesRequireSameEmail: true }, authorizedOptions()))
    .value.settings;
  assert.deepEqual(lenient.state.settingsPatch, { invitesRequireSameEmail: true });
  assert.equal(saved.invitesRequireSameEmail, true);

  // Without anyAccount only the invited address accepts, whatever the workspace saved.
  const off = createFixture({ invitesRequireSameEmail: false });
  assert.equal((await off.service.getWorkspaceSettings(off.state.workspace, authorizedOptions())).value.settings.invitesRequireSameEmail, true);
});
