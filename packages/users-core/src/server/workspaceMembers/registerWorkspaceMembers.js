import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import {
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN } from "../common/diTokens.js";
import { createWorkspaceEntityAndBootstrapEvents } from "../common/support/realtimeServiceEvents.js";

const USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN = "users.workspace.members.service";

function resolveWorkspaceMembersInviteExpiresInMs(appConfig = {}) {
  const inviteExpiresInMs = Number(appConfig?.workspaceMembers?.defaults?.inviteExpiresInMs);
  if (!Number.isInteger(inviteExpiresInMs) || inviteExpiresInMs < 1) {
    throw new TypeError("users.core requires appConfig.workspaceMembers.defaults.inviteExpiresInMs.");
  }

  return inviteExpiresInMs;
}

const INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE = Object.freeze({
  preset: "event_scope",
  async userQuery({ knex, event } = {}) {
    if (typeof knex !== "function") {
      return [];
    }

    const inviteId = Number(event?.entityId);
    if (!Number.isInteger(inviteId) || inviteId < 1) {
      return [];
    }

    const row = await knex("workspace_invites as wi")
      .join("user_profiles as up", "up.email", "wi.email")
      .where("wi.id", inviteId)
      .first("up.id as user_id");

    const userId = Number(row?.user_id || 0);
    if (!Number.isInteger(userId) || userId < 1) {
      return [];
    }

    return [
      {
        userId
      }
    ];
  }
});

function registerWorkspaceMembers(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspaceMembers requires application singleton()/service()/actions().");
  }

  app.service(
    USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN,
    (scope) => {
      const appConfig = resolveAppConfig(scope);
      return createWorkspaceMembersService({
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        inviteExpiresInMs: resolveWorkspaceMembersInviteExpiresInMs(appConfig),
        roleCatalog: createWorkspaceRoleCatalog(appConfig),
        workspaceInvitationsEnabled: scope.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN) === true
      });
    },
    {
      events: deepFreeze({
        updateMemberRole: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "member",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: WORKSPACE_MEMBERS_CHANGED_EVENT
        }),
        removeMember: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "member",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: WORKSPACE_MEMBERS_CHANGED_EVENT
        }),
        createInvite: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "invite",
          workspaceOperation: "created",
          workspaceRealtimeEvent: WORKSPACE_INVITES_CHANGED_EVENT,
          bootstrapEntityId: ({ result }) => result?.createdInviteId,
          bootstrapAudience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
        }),
        revokeInvite: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "invite",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: WORKSPACE_INVITES_CHANGED_EVENT,
          bootstrapEntityId: ({ result }) => result?.revokedInviteId,
          bootstrapAudience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
        })
      })
    }
  );

  app.actions(
    withActionDefaults(workspaceMembersActions, {
      domain: "workspace",
      dependencies: {
        workspaceMembersService: USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN
      }
    })
  );
}

export { registerWorkspaceMembers };
