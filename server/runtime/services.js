import { createAuthService } from "../modules/auth/service.js";
import * as annuityService from "../modules/annuity/service.js";
import { createAnnuityHistoryService } from "../modules/history/service.js";
import { createUserSettingsService } from "../modules/settings/service.js";
import { createAvatarStorageService } from "../modules/users/avatarStorageService.js";
import { createUserAvatarService } from "../modules/users/avatarService.js";
import { createWorkspaceService } from "../modules/workspace/service.js";
import { createWorkspaceAdminService } from "../modules/workspace/adminService.js";
import { createProjectsService } from "../modules/projects/service.js";

function createServices({ repositories, env, nodeEnv, appConfig, rbacManifest, rootDir, supabasePublishableKey }) {
  const {
    userProfilesRepository,
    calculationLogsRepository,
    userSettingsRepository,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
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
    projectsService
  };
}

export { createServices };
