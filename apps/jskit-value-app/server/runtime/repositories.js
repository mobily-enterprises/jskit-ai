import { db } from "../../db/knex.js";
import { createRepository as createHistoryRepository } from "../modules/history/index.js";
import { createRepository as createUserSettingsRepository } from "../modules/settings/index.js";
import { createRepository as createProjectsRepository } from "../modules/projects/index.js";
import { createRepository as createAlertsRepository } from "../modules/alerts/index.js";
import { createRepository as createHealthRepository } from "../modules/health/index.js";
import { createRepository as createAiRepository } from "../modules/ai/index.js";
import { createRepository as createBillingRepository } from "../modules/billing/index.js";
import { createRepository as createChatRepository } from "../modules/chat/index.js";
import { createRepository as createSocialRepository } from "../modules/social/index.js";
import { createRepository as createUserProfilesRepository } from "@jskit-ai/user-profile-core/server";
import { createRepository as createWorkspacesRepository } from "@jskit-ai/workspace-service-core/repositories/workspaces";
import { createRepository as createWorkspaceMembershipsRepository } from "@jskit-ai/workspace-service-core/repositories/memberships";
import { createRepository as createWorkspaceSettingsRepository } from "@jskit-ai/workspace-service-core/repositories/settings";
import { createRepository as createWorkspaceInvitesRepository } from "@jskit-ai/workspace-service-core/repositories/invites";
import { createRepository as createConsoleMembershipsRepository } from "@jskit-ai/workspace-console-service-core/repositories/memberships";
import { createRepository as createConsoleInvitesRepository } from "@jskit-ai/workspace-console-service-core/repositories/invites";
import { createRepository as createConsoleRootRepository } from "@jskit-ai/workspace-console-service-core/repositories/root";
import { createRepository as createConsoleSettingsRepository } from "@jskit-ai/workspace-console-service-core/repositories/settings";
import { createRepository as createConsoleErrorLogsRepository } from "@jskit-ai/workspace-console-service-core/repositories/errorLogs";
import { createRepository as createAuditEventsRepository } from "@jskit-ai/security-audit-core/repositories/auditEvents";

const userProfilesRepository = createUserProfilesRepository(db);
const workspacesRepository = createWorkspacesRepository(db);
const workspaceMembershipsRepository = createWorkspaceMembershipsRepository(db);
const workspaceSettingsRepository = createWorkspaceSettingsRepository(db);
const workspaceInvitesRepository = createWorkspaceInvitesRepository(db);
const consoleMembershipsRepository = createConsoleMembershipsRepository(db);
const consoleInvitesRepository = createConsoleInvitesRepository(db);
const consoleRootRepository = createConsoleRootRepository(db);
const consoleSettingsRepository = createConsoleSettingsRepository(db);
const consoleErrorLogsRepository = createConsoleErrorLogsRepository(db);
const auditEventsRepository = createAuditEventsRepository(db);
const { conversationsRepository: aiTranscriptConversationsRepository, messagesRepository: aiTranscriptMessagesRepository } =
  createAiRepository();
const {
  threadsRepository: chatThreadsRepository,
  participantsRepository: chatParticipantsRepository,
  messagesRepository: chatMessagesRepository,
  idempotencyTombstonesRepository: chatIdempotencyTombstonesRepository,
  attachmentsRepository: chatAttachmentsRepository,
  reactionsRepository: chatReactionsRepository,
  userSettingsRepository: chatUserSettingsRepository,
  blocksRepository: chatBlocksRepository
} = createChatRepository();
const { repository: billingRepository } = createBillingRepository();
const { repository: socialRepository } = createSocialRepository();
const { repository: calculationLogsRepository } = createHistoryRepository();
const { repository: userSettingsRepository } = createUserSettingsRepository();
const { repository: projectsRepository } = createProjectsRepository();
const { repository: alertsRepository } = createAlertsRepository();
const { repository: healthRepository } = createHealthRepository();

const PLATFORM_REPOSITORY_DEFINITIONS = Object.freeze([
  {
    id: "userProfilesRepository",
    create: () => userProfilesRepository
  },
  {
    id: "calculationLogsRepository",
    create: () => calculationLogsRepository
  },
  {
    id: "userSettingsRepository",
    create: () => userSettingsRepository
  },
  {
    id: "workspacesRepository",
    create: () => workspacesRepository
  },
  {
    id: "workspaceMembershipsRepository",
    create: () => workspaceMembershipsRepository
  },
  {
    id: "workspaceSettingsRepository",
    create: () => workspaceSettingsRepository
  },
  {
    id: "workspaceInvitesRepository",
    create: () => workspaceInvitesRepository
  },
  {
    id: "consoleMembershipsRepository",
    create: () => consoleMembershipsRepository
  },
  {
    id: "consoleInvitesRepository",
    create: () => consoleInvitesRepository
  },
  {
    id: "consoleRootRepository",
    create: () => consoleRootRepository
  },
  {
    id: "consoleSettingsRepository",
    create: () => consoleSettingsRepository
  },
  {
    id: "consoleErrorLogsRepository",
    create: () => consoleErrorLogsRepository
  },
  {
    id: "auditEventsRepository",
    create: () => auditEventsRepository
  },
  {
    id: "aiTranscriptConversationsRepository",
    create: () => aiTranscriptConversationsRepository
  },
  {
    id: "aiTranscriptMessagesRepository",
    create: () => aiTranscriptMessagesRepository
  },
  {
    id: "chatThreadsRepository",
    create: () => chatThreadsRepository
  },
  {
    id: "chatParticipantsRepository",
    create: () => chatParticipantsRepository
  },
  {
    id: "chatMessagesRepository",
    create: () => chatMessagesRepository
  },
  {
    id: "chatIdempotencyTombstonesRepository",
    create: () => chatIdempotencyTombstonesRepository
  },
  {
    id: "chatAttachmentsRepository",
    create: () => chatAttachmentsRepository
  },
  {
    id: "chatReactionsRepository",
    create: () => chatReactionsRepository
  },
  {
    id: "chatUserSettingsRepository",
    create: () => chatUserSettingsRepository
  },
  {
    id: "chatBlocksRepository",
    create: () => chatBlocksRepository
  },
  {
    id: "projectsRepository",
    create: () => projectsRepository
  },
  {
    id: "alertsRepository",
    create: () => alertsRepository
  },
  {
    id: "healthRepository",
    create: () => healthRepository
  },
  {
    id: "billingRepository",
    create: () => billingRepository
  },
  {
    id: "socialRepository",
    create: () => socialRepository
  }
]);

export { PLATFORM_REPOSITORY_DEFINITIONS };
