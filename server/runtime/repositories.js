import * as userProfilesRepository from "../modules/users/profileRepository.js";
import * as calculationLogsRepository from "../modules/history/repository.js";
import * as userSettingsRepository from "../modules/settings/repository.js";
import * as workspacesRepository from "../modules/workspace/workspacesRepository.js";
import * as workspaceMembershipsRepository from "../modules/workspace/workspaceMembershipsRepository.js";
import * as workspaceSettingsRepository from "../modules/workspace/workspaceSettingsRepository.js";
import * as workspaceInvitesRepository from "../modules/workspace/workspaceInvitesRepository.js";
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
