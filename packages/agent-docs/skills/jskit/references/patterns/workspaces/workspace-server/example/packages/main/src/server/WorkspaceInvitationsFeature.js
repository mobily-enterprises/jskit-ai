import { defineFeature } from "@jskit-ai/kernel/server/features";
import { renderWorkspaceInviteEmail } from "./email/workspaceInviteEmail.js";
import { createWorkspaceInviteMailer } from "./email/workspaceInviteMailer.js";

/**
 * The application's invitation email: the renderer and the mailer that sends
 * it, each filling one of workspaces-core's optional tokens.
 */
const WorkspaceInvitationsFeature = defineFeature({
  id: "main.workspace-invitations",
  requires: {
    env: "runtime.env"
  },
  provides: {
    inviteEmailTemplate: "workspaces.invite-email-template",
    inviteMailer: "workspaces.invite-mailer"
  },
  /** @param {{ env: import("@jskit-ai/kernel/server/types").RuntimeEnv }} capabilities */
  setup({ env }) {
    return {
      inviteEmailTemplate: renderWorkspaceInviteEmail,
      inviteMailer: createWorkspaceInviteMailer({ env })
    };
  }
});

export { WorkspaceInvitationsFeature };
