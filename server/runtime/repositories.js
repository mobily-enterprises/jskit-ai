import * as userProfilesRepository from "../domain/users/profile.repository.js";
import * as calculationLogsRepository from "../modules/history/repository.js";
import * as userSettingsRepository from "../modules/settings/repository.js";
import * as workspacesRepository from "../domain/workspace/workspaces.repository.js";
import * as workspaceMembershipsRepository from "../domain/workspace/memberships.repository.js";
import * as workspaceSettingsRepository from "../domain/workspace/settings.repository.js";
import * as workspaceInvitesRepository from "../domain/workspace/invites.repository.js";
import * as projectsRepository from "../modules/projects/repository.js";

function createRepositories() {
  return {
    userProfilesRepository,
    calculationLogsRepository,
    userSettingsRepository,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    projectsRepository
  };
}

export { createRepositories };
