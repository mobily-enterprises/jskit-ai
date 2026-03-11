import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { workspaceDirectoryActions } from "./workspaceDirectoryActions.js";

const USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN = "users.core.workspaceDirectory.actionDefinitions";

function registerWorkspaceDirectory(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceDirectory requires application singleton().");
  }

  registerActionDefinitions(app, USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN, {
    contributorId: "users.workspace-directory",
    domain: "workspace",
    dependencies: {
      workspaceService: "users.workspace.service"
    },
    actions: workspaceDirectoryActions
  });
}

export { registerWorkspaceDirectory };
