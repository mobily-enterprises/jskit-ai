import { createService as createAuthService } from "../modules/auth/service.js";
import { createService as createAnnuityService } from "../domain/annuity/calculator.service.js";
import { createService as createAnnuityHistoryService } from "../modules/history/service.js";
import { createService as createSmsService } from "../domain/communications/services/sms.service.js";
import { createService as createCommunicationsService } from "../modules/communications/service.js";
import { createService as createUserSettingsService } from "../modules/settings/service.js";
import { createService as createAvatarStorageService } from "../domain/users/avatarStorage.service.js";
import { createService as createUserAvatarService } from "../domain/users/avatar.service.js";
import { createService as createWorkspaceService } from "../domain/workspace/services/workspace.service.js";
import { createService as createWorkspaceAdminService } from "../domain/workspace/services/admin.service.js";
import { createService as createWorkspaceInviteEmailService } from "../domain/workspace/services/inviteEmail.service.js";
import { createService as createConsoleService } from "../domain/console/services/console.service.js";
import { createService as createConsoleErrorsService } from "../domain/console/services/errors.service.js";
import { createService as createAuditService } from "../domain/security/services/audit.service.js";
import { createService as createRealtimeEventsService } from "../domain/realtime/services/events.service.js";
import { createService as createObservabilityService } from "../modules/observability/service.js";
import { createService as createProjectsService } from "../modules/projects/service.js";
import { createService as createHealthService } from "../modules/health/service.js";
import { createService as createAiService } from "../modules/ai/service.js";
import { createOpenAiClient } from "../modules/ai/provider/openaiClient.js";

function createServices({
  repositories,
  env,
  nodeEnv,
  appConfig,
  rbacManifest,
  rootDir,
  supabasePublishableKey,
  observabilityRegistry
}) {
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
    consoleErrorLogsRepository,
    auditEventsRepository,
    projectsRepository,
    healthRepository
  } = repositories;

  const observabilityService = createObservabilityService({
    metricsRegistry: observabilityRegistry,
    metricsEnabled: env.METRICS_ENABLED,
    metricsBearerToken: env.METRICS_BEARER_TOKEN
  });

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
  const smsService = createSmsService({
    driver: env.SMS_DRIVER,
    plivoAuthId: env.PLIVO_AUTH_ID,
    plivoAuthToken: env.PLIVO_AUTH_TOKEN,
    plivoSourceNumber: env.PLIVO_SOURCE_NUMBER
  });

  const communicationsService = createCommunicationsService({
    smsService
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

  const workspaceInviteEmailService = createWorkspaceInviteEmailService({
    driver: env.WORKSPACE_INVITE_EMAIL_DRIVER,
    appPublicUrl: env.APP_PUBLIC_URL,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpSecure: env.SMTP_SECURE,
    smtpUsername: env.SMTP_USERNAME,
    smtpPassword: env.SMTP_PASSWORD,
    smtpFrom: env.SMTP_FROM
  });

  const workspaceAdminService = createWorkspaceAdminService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    userProfilesRepository,
    userSettingsRepository,
    workspaceInviteEmailService
  });

  const consoleService = createConsoleService({
    consoleMembershipsRepository,
    consoleInvitesRepository,
    consoleRootRepository,
    userProfilesRepository
  });

  const consoleErrorsService = createConsoleErrorsService({
    consoleMembershipsRepository,
    consoleErrorLogsRepository,
    observabilityService
  });

  const auditService = createAuditService({
    auditEventsRepository,
    observabilityService
  });

  const projectsService = createProjectsService({
    projectsRepository
  });

  const realtimeEventsService = createRealtimeEventsService();

  const aiProviderClient = createOpenAiClient({
    enabled: env.AI_ENABLED,
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    timeoutMs: env.AI_TIMEOUT_MS
  });

  const aiService = createAiService({
    providerClient: aiProviderClient,
    workspaceAdminService,
    realtimeEventsService,
    auditService,
    observabilityService,
    aiModel: env.AI_MODEL,
    aiMaxInputChars: env.AI_MAX_INPUT_CHARS,
    aiMaxHistoryMessages: env.AI_MAX_HISTORY_MESSAGES,
    aiMaxToolCallsPerTurn: env.AI_MAX_TOOL_CALLS_PER_TURN
  });

  const healthService = createHealthService({
    healthRepository
  });

  return {
    authService,
    annuityService,
    annuityHistoryService,
    smsService,
    communicationsService,
    avatarStorageService,
    userAvatarService,
    userSettingsService,
    workspaceService,
    workspaceInviteEmailService,
    workspaceAdminService,
    consoleService,
    consoleErrorsService,
    observabilityService,
    auditService,
    projectsService,
    realtimeEventsService,
    aiService,
    healthService
  };
}

export { createServices };
