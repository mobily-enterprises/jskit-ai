import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { workspaceInvitesResource } from "../shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../shared/resources/workspaceMembershipsResource.js";
import { workspaceResource } from "../shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../shared/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../shared/roles.js";
import { resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { createRepository as createWorkspaceInvitesRepository } from "./common/repositories/workspaceInvitesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "./common/repositories/workspacesRepository.js";
import { createService as createWorkspaceService } from "./common/services/workspaceContextService.js";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";
import { registerWorkspaceDirectoryRoutes } from "./workspaceDirectory/bootWorkspaceDirectoryRoutes.js";
import { buildWorkspaceDirectoryActions } from "./workspaceDirectory/workspaceDirectoryActions.js";
import { renderDefaultWorkspaceInviteEmail } from "./workspaceMembers/defaultWorkspaceInviteEmail.js";
import { registerWorkspaceMembersRoutes } from "./workspaceMembers/bootWorkspaceMembers.js";
import { buildWorkspaceMembersActions } from "./workspaceMembers/workspaceMembersActions.js";
import { createWorkspaceInviteUrlBuilder } from "./workspaceMembers/workspaceInviteUrls.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembers/workspaceMembersService.js";
import { registerWorkspacePendingInvitationsRoutes } from "./workspacePendingInvitations/bootWorkspacePendingInvitations.js";
import { buildWorkspacePendingInvitationsActions } from "./workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { createService as createWorkspacePendingInvitationsService } from "./workspacePendingInvitations/workspacePendingInvitationsService.js";
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/bootWorkspaceSettings.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettings/workspaceSettingsRepository.js";
import { buildWorkspaceSettingsActions } from "./workspaceSettings/workspaceSettingsActions.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettings/workspaceSettingsService.js";
import { resolveWorkspaceInvitationsPolicy } from "./support/workspaceInvitationsPolicy.js";
import { workspaceSlugParamsValidator } from "./common/validators/routeParamsValidator.js";
import { buildWorkspaceInputFromRouteParams } from "./support/workspaceRouteInput.js";
import { resolveWorkspace } from "./support/resolveWorkspace.js";

function requirePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return normalized;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean.`);
  }
  return value;
}

function resolveInviteEmailTemplate(config) {
  const template =
    config.workspaceInviteEmailTemplate ||
    config.workspaceInviteEmailRenderer ||
    config.workspaceInvitations?.emailTemplate ||
    config.workspaceInvitations?.emailRenderer;
  return typeof template === "function" ? template : renderDefaultWorkspaceInviteEmail;
}

async function installWorkspaceResources(jsonRestApi) {
  const scopeOptions = { writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc } };
  await addResourceIfMissing(
    jsonRestApi,
    "workspaces",
    createJsonRestResourceScopeOptions(workspaceResource, scopeOptions)
  );
  await addResourceIfMissing(
    jsonRestApi,
    "workspaceMemberships",
    createJsonRestResourceScopeOptions(workspaceMembershipsResource, scopeOptions)
  );
  await addResourceIfMissing(
    jsonRestApi,
    "workspaceInvites",
    createJsonRestResourceScopeOptions(workspaceInvitesResource, scopeOptions)
  );
  await addResourceIfMissing(
    jsonRestApi,
    "workspaceSettings",
    createJsonRestResourceScopeOptions(workspaceSettingsResource, scopeOptions)
  );
}

function createWorkspacesRuntime({ config, database, env, jsonRestApi } = {}) {
  const tenancyProfile = resolveTenancyProfile(config);
  const invitationsPolicy = resolveWorkspaceInvitationsPolicy({ config, appConfig: config, tenancyProfile });
  const invitationsEnabled = invitationsPolicy.enabled === true;
  const roleCatalog = createWorkspaceRoleCatalog(config);
  const workspaceSettingsRepository = createWorkspaceSettingsRepository({
    api: jsonRestApi,
    knex: database.knex,
    defaultInvitesEnabled: requireBoolean(
      config?.workspaceSettings?.defaults?.invitesEnabled,
      "runtime.config.workspaceSettings.defaults.invitesEnabled"
    )
  });
  const workspacesRepository = createWorkspacesRepository({ api: jsonRestApi, knex: database.knex });
  const workspaceMembershipsRepository = createWorkspaceMembershipsRepository({
    api: jsonRestApi,
    knex: database.knex
  });
  const workspaceInvitesRepository = createWorkspaceInvitesRepository({
    api: jsonRestApi,
    knex: database.knex
  });
  const workspaceService = createWorkspaceService({
    appConfig: config,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository
  });
  const workspacePendingInvitationsService = createWorkspacePendingInvitationsService({
    workspaceInvitesRepository,
    workspaceMembershipsRepository
  });
  const workspaceMembersService = createWorkspaceMembersService({
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    inviteExpiresInMs: requirePositiveInteger(
      config?.workspaceMembers?.defaults?.inviteExpiresInMs,
      "runtime.config.workspaceMembers.defaults.inviteExpiresInMs"
    ),
    roleCatalog,
    workspaceInvitationsEnabled: invitationsEnabled,
    inviteUrlBuilder: createWorkspaceInviteUrlBuilder({ appConfig: config, env }),
    workspaceInviteMailer: config?.workspaceInviteMailer || null,
    workspaceInviteEmailTemplate: resolveInviteEmailTemplate(config)
  });
  const workspaceSettingsService = createWorkspaceSettingsService({
    workspaceSettingsRepository,
    workspaceInvitationsEnabled: invitationsEnabled,
    roleCatalog
  });

  return Object.freeze({
    config,
    enabled: tenancyProfile.workspace.enabled === true,
    invitationsEnabled,
    selfCreateEnabled: tenancyProfile.workspace.allowSelfCreate === true,
    scope: Object.freeze({
      params: workspaceSlugParamsValidator,
      buildInputFromRouteParams: buildWorkspaceInputFromRouteParams,
      resolveWorkspace
    }),
    tenancyProfile,
    repositories: Object.freeze({
      workspaceInvites: workspaceInvitesRepository,
      workspaceMemberships: workspaceMembershipsRepository,
      workspaceSettings: workspaceSettingsRepository,
      workspaces: workspacesRepository
    }),
    services: Object.freeze({
      directory: workspaceService,
      members: workspaceMembersService,
      pendingInvitations: workspacePendingInvitationsService,
      settings: workspaceSettingsService
    })
  });
}

const WorkspacesFeature = defineFeature({
  id: "workspaces.core",
  domain: "workspace",
  requires: {
    bootstrap: "runtime.bootstrap",
    config: "runtime.config",
    database: "runtime.database",
    env: "runtime.env",
    http: "runtime.http",
    jsonRestApi: "runtime.json-rest-api",
    users: "users.core"
  },
  provides: {
    workspaces: "workspaces.core"
  },
  async setup({ bootstrap, config, database, env, http, jsonRestApi, users }) {
    await installWorkspaceResources(jsonRestApi);
    const workspaces = createWorkspacesRuntime({ config, database, env, jsonRestApi });

    bootstrap.register({
      id: "workspaces.bootstrap",
      order: 200,
      contribute: createWorkspaceBootstrapContributor({
        appConfig: config,
        tenancyProfile: workspaces.tenancyProfile,
        userProfilesRepository: users.repositories.userProfiles,
        workspaceInvitationsEnabled: workspaces.invitationsEnabled,
        workspacePendingInvitationsService: workspaces.services.pendingInvitations,
        workspaceService: workspaces.services.directory
      }).contribute
    });

    if (workspaces.enabled) {
      registerWorkspaceDirectoryRoutes(http.router, {
        config,
        workspaceSelfCreateEnabled: workspaces.selfCreateEnabled
      });
      registerWorkspaceSettingsRoutes(http.router, { config });
      registerWorkspaceMembersRoutes(http.router, {
        config,
        workspaceInvitationsEnabled: workspaces.invitationsEnabled
      });
      if (workspaces.invitationsEnabled) {
        registerWorkspacePendingInvitationsRoutes(http.router);
      }
    }

    return { workspaces };
  },
  actions({ workspaces }) {
    if (!workspaces.enabled) return [];
    return [
      ...buildWorkspaceDirectoryActions({ workspaceService: workspaces.services.directory }),
      ...buildWorkspaceSettingsActions({ workspaceSettingsService: workspaces.services.settings }),
      ...buildWorkspaceMembersActions({ workspaceMembersService: workspaces.services.members }),
      ...(workspaces.invitationsEnabled
        ? buildWorkspacePendingInvitationsActions({
            workspacePendingInvitationsService: workspaces.services.pendingInvitations
          })
        : [])
    ];
  }
});

export { WorkspacesFeature, createWorkspacesRuntime, installWorkspaceResources };
