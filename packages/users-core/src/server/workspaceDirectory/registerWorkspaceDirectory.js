import { workspaceDirectoryActions } from "./workspaceDirectoryActions.js";

function registerWorkspaceDirectory(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspaceDirectory requires application singleton()/actions().");
  }

  app.actions({
    contributorId: "users.workspace-directory",
    domain: "workspace",
    dependencies: {
      workspaceService: "users.workspace.service"
    },
    actions: workspaceDirectoryActions
  });
}

export { registerWorkspaceDirectory };
