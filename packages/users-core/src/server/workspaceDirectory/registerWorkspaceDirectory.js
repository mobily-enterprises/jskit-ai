import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN
} from "../common/diTokens.js";
import { workspaceDirectoryActions } from "./workspaceDirectoryActions.js";

function registerWorkspaceDirectory(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function" || typeof app.make !== "function") {
    throw new Error("registerWorkspaceDirectory requires application singleton()/actions()/make().");
  }

  const workspaceSelfCreateEnabled = app.make(USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN) === true;
  const actions = workspaceSelfCreateEnabled
    ? workspaceDirectoryActions
    : workspaceDirectoryActions.filter((action) => action.id !== "workspace.workspaces.create");

  app.actions(
    withActionDefaults(actions, {
      domain: "workspace",
      dependencies: {
        workspaceService: "users.workspace.service"
      }
    })
  );
}

export { registerWorkspaceDirectory };
