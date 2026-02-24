import * as userProfilesRepository from "../domain/users/profile.repository.js";
import * as calculationLogsRepository from "../modules/history/repository.js";
import * as userSettingsRepository from "../modules/settings/repository.js";
import * as workspacesRepository from "../domain/workspace/repositories/workspaces.repository.js";
import * as workspaceMembershipsRepository from "../domain/workspace/repositories/memberships.repository.js";
import * as workspaceSettingsRepository from "../domain/workspace/repositories/settings.repository.js";
import * as workspaceInvitesRepository from "../domain/workspace/repositories/invites.repository.js";
import * as consoleMembershipsRepository from "../domain/console/repositories/memberships.repository.js";
import * as consoleInvitesRepository from "../domain/console/repositories/invites.repository.js";
import * as consoleRootRepository from "../domain/console/repositories/root.repository.js";
import * as consoleSettingsRepository from "../domain/console/repositories/settings.repository.js";
import * as consoleErrorLogsRepository from "../domain/console/repositories/errorLogs.repository.js";
import * as auditEventsRepository from "../domain/security/repositories/auditEvents.repository.js";
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
import { createRepositoryRegistry } from "@jskit-ai/server-runtime-core/composition";

const REPOSITORY_DEFINITIONS = Object.freeze([
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

function createRepositories() {
  return createRepositoryRegistry(REPOSITORY_DEFINITIONS);
}

export { createRepositories };
