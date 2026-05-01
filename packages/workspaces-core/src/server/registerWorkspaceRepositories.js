import { INTERNAL_JSON_REST_API } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { createRepository as createWorkspacesRepository } from "./common/repositories/workspacesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspaceInvitesRepository } from "./common/repositories/workspaceInvitesRepository.js";

function registerWorkspaceRepositories(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceRepositories requires application singleton().");
  }

  app.singleton("internal.repository.workspaces", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    return createWorkspacesRepository({ api, knex });
  });

  app.singleton("internal.repository.workspace-memberships", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    return createWorkspaceMembershipsRepository({ api, knex });
  });

  app.singleton("internal.repository.workspace-invites", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    return createWorkspaceInvitesRepository({ api, knex });
  });
}

export { registerWorkspaceRepositories };
