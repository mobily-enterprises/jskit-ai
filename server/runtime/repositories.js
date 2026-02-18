import * as userProfilesRepository from "../../repositories/userProfilesRepository.js";
import * as calculationLogsRepository from "../../repositories/calculationLogsRepository.js";
import * as userSettingsRepository from "../../repositories/userSettingsRepository.js";
import * as workspacesRepository from "../../repositories/workspacesRepository.js";
import * as workspaceMembershipsRepository from "../../repositories/workspaceMembershipsRepository.js";
import * as workspaceSettingsRepository from "../../repositories/workspaceSettingsRepository.js";
import * as workspaceInvitesRepository from "../../repositories/workspaceInvitesRepository.js";
import * as projectsRepository from "../../repositories/workspace/projectsRepository.js";

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
