import { INTERNAL_JSON_REST_API, addResourceIfMissing } from "@jskit-ai/users-core/server/jsonRestApiHost";
import { workspacesResource } from "./resources/workspacesResource.js";
import { workspaceMembershipsResource } from "./resources/workspaceMembershipsResource.js";
import { workspaceInvitesResource } from "./resources/workspaceInvitesResource.js";
import { workspaceSettingsResource } from "./resources/workspaceSettingsResource.js";

async function registerWorkspaceJsonRestResources(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceJsonRestResources requires application make().");
  }

  const api = app.make(INTERNAL_JSON_REST_API);
  await addResourceIfMissing(api, "workspaces", workspacesResource);
  await addResourceIfMissing(api, "workspaceMemberships", workspaceMembershipsResource);
  await addResourceIfMissing(api, "workspaceInvites", workspaceInvitesResource);
  await addResourceIfMissing(api, "workspaceSettings", workspaceSettingsResource);
  return api;
}

export { registerWorkspaceJsonRestResources };
