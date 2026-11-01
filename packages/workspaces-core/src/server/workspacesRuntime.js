import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { workspaceInvitesResource } from "../shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../shared/resources/workspaceMembershipsResource.js";
import { workspaceResource } from "../shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../shared/resources/workspaceSettingsResource.js";
import { createWorkspaceRoleCatalog } from "../shared/roles.js";
import { WORKSPACE_SETTINGS_COLOR_FIELDS, normalizeWorkspaceHexColor } from "../shared/settings.js";
import { resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { createRepository as createWorkspaceInvitesRepository } from "./common/repositories/workspaceInvitesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "./common/repositories/workspacesRepository.js";
import { createService as createWorkspaceService } from "./common/services/workspaceDirectoryService.js";
import { createWorkspacesServerI18n } from "./i18n.js";
import { createWorkspaceInviteUrlBuilder } from "./workspaceMembers/workspaceInviteUrls.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembers/workspaceMembersService.js";
import { createService as createWorkspacePendingInvitationsService } from "./workspacePendingInvitations/workspacePendingInvitationsService.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettings/workspaceSettingsRepository.js";
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

function requireWorkspaceColorDefaults(defaults) {
  const colors = {};
  for (const fieldName of WORKSPACE_SETTINGS_COLOR_FIELDS) {
    if (defaults?.[fieldName] === undefined) {
      continue;
    }
    const color = normalizeWorkspaceHexColor(defaults[fieldName]);
    if (!color) {
      throw new TypeError(`runtime.config.workspaceSettings.defaults.${fieldName} must be a hex color like #1867C0.`);
    }
    colors[fieldName] = color;
  }
  return colors;
}

/** @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} jsonRestApi */
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

/**
 * The `workspaces.core` capability: the workspace repositories and services,
 * built from the runtime config.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} dependencies.appRoot
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} dependencies.config
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").WorkspaceInviteMailer} dependencies.inviteMailer
 * @param {import("./types.js").WorkspaceInviteEmailTemplate} dependencies.inviteEmailTemplate
 * @param {import("./types.js").WorkspaceInviteAcceptanceParticipant} dependencies.inviteAcceptanceParticipant
 * @param {import("./types.js").PersonalWorkspaceName} dependencies.personalWorkspaceName
 * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} dependencies.jsonRestApi
 * @param {import("@jskit-ai/users-core/server/types").UsersCore} dependencies.users
 */
function createWorkspacesRuntime({
  appRoot,
  config,
  env,
  inviteMailer,
  inviteEmailTemplate,
  inviteAcceptanceParticipant,
  personalWorkspaceName,
  jsonRestApi,
  users
}) {
  const tenancyProfile = resolveTenancyProfile(config);
  const invitationsPolicy = resolveWorkspaceInvitationsPolicy({ appConfig: config, tenancyProfile });
  const invitationsEnabled = invitationsPolicy.enabled === true;
  const roleCatalog = createWorkspaceRoleCatalog(config);
  const workspaceSettingsRepository = createWorkspaceSettingsRepository({
    api: jsonRestApi,
    defaultInvitesEnabled: requireBoolean(
      config?.workspaceSettings?.defaults?.invitesEnabled,
      "runtime.config.workspaceSettings.defaults.invitesEnabled"
    ),
    defaultColorSettings: requireWorkspaceColorDefaults(config?.workspaceSettings?.defaults)
  });
  const workspacesRepository = createWorkspacesRepository({ api: jsonRestApi });
  const workspaceMembershipsRepository = createWorkspaceMembershipsRepository({ api: jsonRestApi });
  const workspaceInvitesRepository = createWorkspaceInvitesRepository({ api: jsonRestApi });
  const workspaceService = createWorkspaceService({
    tenancyProfile,
    roleCatalog,
    personalWorkspaceName,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository
  });
  const workspacePendingInvitationsService = createWorkspacePendingInvitationsService({
    workspaceInvitesRepository,
    workspaceMembershipsRepository,
    roleCatalog,
    acceptanceParticipant: inviteAcceptanceParticipant
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
    workspaceInviteMailer: inviteMailer,
    workspaceInviteEmailTemplate: inviteEmailTemplate,
    i18n: createWorkspacesServerI18n({ appRoot }),
    userProfilesRepository: users.repositories.userProfiles,
    userSettingsRepository: users.repositories.userSettings
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

export { createWorkspacesRuntime, installWorkspaceResources };
