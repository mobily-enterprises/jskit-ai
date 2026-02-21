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
import * as projectsRepository from "../modules/projects/repository.js";
import * as healthRepository from "../modules/health/repository.js";
import * as billingRepository from "../modules/billing/repository.js";

function createRepositories() {
  return {
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
    consoleSettingsRepository,
    consoleErrorLogsRepository,
    auditEventsRepository,
    aiTranscriptConversationsRepository,
    aiTranscriptMessagesRepository,
    projectsRepository,
    healthRepository,
    billingRepository
  };
}

export { createRepositories };
