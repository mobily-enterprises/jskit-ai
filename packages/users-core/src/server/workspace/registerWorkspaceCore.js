import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  registerActionDefinitions,
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { TENANCY_MODE_WORKSPACE, normalizeTenancyMode } from "@jskit-ai/kernel/shared/surface";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { createService as createWorkspaceService } from "./workspaceService.js";
import { createWorkspaceActionContextContributor } from "./workspaceActionContextContributor.js";
import { workspaceBootstrapActions } from "../workspaceBootstrap/workspaceBootstrapActions.js";
import { workspaceDirectoryActions } from "../workspaceDirectory/workspaceDirectoryActions.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "../common/diTokens.js";

const USERS_WORKSPACE_BOOTSTRAP_CONTRIBUTOR_TOKEN = "users.core.workspaceBootstrap.actionDefinitions";
const USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN = "users.core.workspaceDirectory.actionDefinitions";
const USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN = "users.core.workspace.actionContextContributor";

function resolveWorkspaceTenancyEnabled(appConfig = {}) {
  return normalizeTenancyMode(appConfig.tenancyMode) === TENANCY_MODE_WORKSPACE;
}

function registerWorkspaceCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceCore requires application singleton().");
  }

  app.singleton("users.workspace.service", (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createWorkspaceService({
      appConfig,
      workspacesRepository: scope.make("workspacesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceSettingsRepository: scope.make("workspaceSettingsRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository")
    });
  });

  app.singleton(KERNEL_TOKENS.SurfaceRuntime, (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createSurfaceRuntime({
      tenancyMode: appConfig.tenancyMode,
      allMode: appConfig.surfaceModeAll,
      surfaces: appConfig.surfaceDefinitions,
      defaultSurfaceId: appConfig.surfaceDefaultId
    });
  });

  app.singleton(USERS_WORKSPACE_TENANCY_ENABLED_TOKEN, (scope) => {
    const appConfig = scope.make("appConfig");
    return resolveWorkspaceTenancyEnabled(appConfig);
  });

  registerActionDefinitions(app, USERS_WORKSPACE_BOOTSTRAP_CONTRIBUTOR_TOKEN, {
    contributorId: "users.workspace-bootstrap",
    domain: "workspace",
    dependencies: {
      workspaceService: "users.workspace.service",
      workspacePendingInvitationsService: USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
      workspaceTenancyEnabled: USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
    },
    actions: workspaceBootstrapActions
  });

  registerActionDefinitions(app, USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN, {
    contributorId: "users.workspace-directory",
    domain: "workspace",
    dependencies: {
      workspaceService: "users.workspace.service"
    },
    actions: workspaceDirectoryActions
  });

  registerActionContextContributor(app, USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN, (scope) => {
    return createWorkspaceActionContextContributor({
      workspaceService: scope.make("users.workspace.service")
    });
  });
}

export { registerWorkspaceCore };
