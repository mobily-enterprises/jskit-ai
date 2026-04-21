import { createRepository as createWorkspacesRepository } from "./common/repositories/workspacesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspaceInvitesRepository } from "./common/repositories/workspaceInvitesRepository.js";

function registerWorkspaceRepositories(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceRepositories requires application singleton().");
  }

  app.singleton("internal.repository.workspaces", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createWorkspacesRepository(knex);
  });

  app.singleton("internal.repository.workspace-memberships", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createWorkspaceMembershipsRepository(knex);
  });

  app.singleton("internal.repository.workspace-invites", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createWorkspaceInvitesRepository(knex);
  });
}

export { registerWorkspaceRepositories };
