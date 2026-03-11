import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { createRepository as createUserProfilesRepository } from "./repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./repositories/userSettingsRepository.js";
import { createRepository as createWorkspacesRepository } from "./repositories/workspacesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspaceInvitesRepository } from "./repositories/workspaceInvitesRepository.js";
import { createRepository as createConsoleSettingsRepository } from "../consoleSettings/consoleSettingsRepository.js";

function registerCommonRepositories(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerCommonRepositories requires application singleton().");
  }

  app.singleton("userProfilesRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createUserProfilesRepository(knex);
  });

  app.singleton("userSettingsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createUserSettingsRepository(knex);
  });

  app.singleton("workspacesRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createWorkspacesRepository(knex);
  });

  app.singleton("workspaceMembershipsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createWorkspaceMembershipsRepository(knex);
  });

  app.singleton("workspaceInvitesRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createWorkspaceInvitesRepository(knex);
  });

  app.singleton("consoleSettingsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createConsoleSettingsRepository(knex);
  });
}

export { registerCommonRepositories };
