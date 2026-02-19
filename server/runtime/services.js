import { createService as createAuthService } from "../modules/auth/service.js";
import { createService as createAnnuityService } from "../domain/annuity/calculator.service.js";
import { createService as createAnnuityHistoryService } from "../modules/history/service.js";
import { createService as createUserSettingsService } from "../modules/settings/service.js";
import { createService as createAvatarStorageService } from "../domain/users/avatarStorage.service.js";
import { createService as createUserAvatarService } from "../domain/users/avatar.service.js";
import { createService as createWorkspaceService } from "../domain/workspace/services/workspace.service.js";
import { createService as createWorkspaceAdminService } from "../domain/workspace/services/admin.service.js";
import { createService as createConsoleService } from "../domain/console/services/console.service.js";
import { createService as createProjectsService } from "../modules/projects/service.js";

function createServices({ repositories, env, nodeEnv, appConfig, rbacManifest, rootDir, supabasePublishableKey }) {
  const {
    userProfilesRepository,
    calculationLogsRepository,
    userSettingsRepository,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    projectsRepository
  } = repositories;

  const authService = createAuthService({
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey,
    appPublicUrl: env.APP_PUBLIC_URL,
    jwtAudience: env.SUPABASE_JWT_AUDIENCE,
    userProfilesRepository,
    userSettingsRepository,
    nodeEnv
  });

  const annuityHistoryService = createAnnuityHistoryService({
    calculationLogsRepository
  });
  const annuityService = createAnnuityService();

  const avatarStorageService = createAvatarStorageService({
    driver: env.AVATAR_STORAGE_DRIVER,
    fsBasePath: env.AVATAR_STORAGE_FS_BASE_PATH,
    publicBasePath: env.AVATAR_PUBLIC_BASE_PATH,
    rootDir
  });

  const userAvatarService = createUserAvatarService({
    userProfilesRepository,
    avatarStorageService
  });

  const userSettingsService = createUserSettingsService({
    userSettingsRepository,
    userProfilesRepository,
    authService,
    userAvatarService
  });

  const workspaceService = createWorkspaceService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    userSettingsRepository,
    userAvatarService
  });

  const workspaceAdminService = createWorkspaceAdminService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    userProfilesRepository,
    userSettingsRepository
  });

  const consoleService = createConsoleService({
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    userProfilesRepository
  });

  const projectsService = createProjectsService({
    projectsRepository
  });

  return {
    authService,
    annuityService,
    annuityHistoryService,
    avatarStorageService,
    userAvatarService,
    userSettingsService,
    workspaceService,
    workspaceAdminService,
    consoleService,
    projectsService
  };
}

export { createServices };
