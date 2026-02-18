import * as userProfilesRepository from "../modules/users/profile.repository.js";
import * as calculationLogsRepository from "../modules/history/repository.js";
import * as userSettingsRepository from "../modules/settings/repository.js";
import * as workspacesRepository from "../modules/workspace/workspaces.repository.js";
import * as workspaceMembershipsRepository from "../modules/workspace/memberships.repository.js";
import * as workspaceSettingsRepository from "../modules/workspace/settings.repository.js";
import * as workspaceInvitesRepository from "../modules/workspace/invites.repository.js";
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
