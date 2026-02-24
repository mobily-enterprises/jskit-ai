import { db } from "../../db/knex.js";
import { calculationLogsRepository } from "../modules/history/index.js";
import { userSettingsRepository } from "../modules/settings/index.js";
import { projectsRepository } from "../modules/projects/index.js";
import { healthRepository } from "../modules/health/index.js";
import { createRepository as createAiTranscriptConversationsRepository } from "@jskit-ai/assistant-transcripts-knex-mysql/repositories/conversations";
import { createRepository as createAiTranscriptMessagesRepository } from "@jskit-ai/assistant-transcripts-knex-mysql/repositories/messages";
import { createRepository as createBillingRepository } from "@jskit-ai/billing-knex-mysql/repository";
import { createRepository as createChatThreadsRepository } from "@jskit-ai/chat-knex-mysql/repositories/threads";
import { createRepository as createChatParticipantsRepository } from "@jskit-ai/chat-knex-mysql/repositories/participants";
import { createRepository as createChatMessagesRepository } from "@jskit-ai/chat-knex-mysql/repositories/messages";
import { createRepository as createChatIdempotencyTombstonesRepository } from "@jskit-ai/chat-knex-mysql/repositories/idempotencyTombstones";
import { createRepository as createChatAttachmentsRepository } from "@jskit-ai/chat-knex-mysql/repositories/attachments";
import { createRepository as createChatReactionsRepository } from "@jskit-ai/chat-knex-mysql/repositories/reactions";
import { createRepository as createChatUserSettingsRepository } from "@jskit-ai/chat-knex-mysql/repositories/userSettings";
import { createRepository as createChatBlocksRepository } from "@jskit-ai/chat-knex-mysql/repositories/blocks";
import { createRepository as createUserProfilesRepository } from "@jskit-ai/user-profile-knex-mysql";
import { createRepository as createWorkspacesRepository } from "@jskit-ai/workspace-knex-mysql/repositories/workspaces";
import { createRepository as createWorkspaceMembershipsRepository } from "@jskit-ai/workspace-knex-mysql/repositories/memberships";
import { createRepository as createWorkspaceSettingsRepository } from "@jskit-ai/workspace-knex-mysql/repositories/settings";
import { createRepository as createWorkspaceInvitesRepository } from "@jskit-ai/workspace-knex-mysql/repositories/invites";
import { createRepository as createConsoleMembershipsRepository } from "@jskit-ai/workspace-console-knex-mysql/repositories/memberships";
import { createRepository as createConsoleInvitesRepository } from "@jskit-ai/workspace-console-knex-mysql/repositories/invites";
import { createRepository as createConsoleRootRepository } from "@jskit-ai/workspace-console-knex-mysql/repositories/root";
import { createRepository as createConsoleSettingsRepository } from "@jskit-ai/workspace-console-knex-mysql/repositories/settings";
import { createRepository as createConsoleErrorLogsRepository } from "@jskit-ai/workspace-console-knex-mysql/repositories/errorLogs";
import { createRepository as createAuditEventsRepository } from "@jskit-ai/security-audit-knex-mysql/repositories/auditEvents";

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
const aiTranscriptConversationsRepository = createAiTranscriptConversationsRepository(db);
const aiTranscriptMessagesRepository = createAiTranscriptMessagesRepository(db);
const chatThreadsRepository = createChatThreadsRepository(db);
const chatParticipantsRepository = createChatParticipantsRepository(db);
const chatMessagesRepository = createChatMessagesRepository(db);
const chatIdempotencyTombstonesRepository = createChatIdempotencyTombstonesRepository(db);
const chatAttachmentsRepository = createChatAttachmentsRepository(db);
const chatReactionsRepository = createChatReactionsRepository(db);
const chatUserSettingsRepository = createChatUserSettingsRepository(db);
const chatBlocksRepository = createChatBlocksRepository(db);
const billingRepository = createBillingRepository(db);

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
    id: "healthRepository",
    create: () => healthRepository
  },
  {
    id: "billingRepository",
    create: () => billingRepository
  }
]);

export { PLATFORM_REPOSITORY_DEFINITIONS };
