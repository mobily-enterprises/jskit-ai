import { db } from "../../db/knex.js";
import * as calculationLogsRepository from "../modules/history/repository.js";
import * as userSettingsRepository from "../modules/settings/repository.js";
import * as aiTranscriptConversationsRepository from "../modules/ai/repositories/conversations.repository.js";
import * as aiTranscriptMessagesRepository from "../modules/ai/repositories/messages.repository.js";
import * as chatThreadsRepository from "../modules/chat/repositories/threads.repository.js";
import * as chatParticipantsRepository from "../modules/chat/repositories/participants.repository.js";
import * as chatMessagesRepository from "../modules/chat/repositories/messages.repository.js";
import * as chatIdempotencyTombstonesRepository from "../modules/chat/repositories/idempotencyTombstones.repository.js";
import * as chatAttachmentsRepository from "../modules/chat/repositories/attachments.repository.js";
import * as chatReactionsRepository from "../modules/chat/repositories/reactions.repository.js";
import * as chatUserSettingsRepository from "../modules/chat/repositories/userSettings.repository.js";
import * as chatBlocksRepository from "../modules/chat/repositories/blocks.repository.js";
import * as projectsRepository from "../modules/projects/repository.js";
import * as healthRepository from "../modules/health/repository.js";
import * as billingRepository from "../modules/billing/repository.js";
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
