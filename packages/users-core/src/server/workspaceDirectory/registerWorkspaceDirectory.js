import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { workspaceDirectoryActions } from "./workspaceDirectoryActions.js";

function registerWorkspaceDirectory(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspaceDirectory requires application singleton()/actions().");
  }

  app.actions(
    withActionDefaults(workspaceDirectoryActions, {
      domain: "workspace",
      dependencies: {
        workspaceService: "users.workspace.service"
      }
    })
  );
}

export { registerWorkspaceDirectory };
