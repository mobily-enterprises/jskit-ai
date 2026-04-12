import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeDbRecordId } from "@jskit-ai/database-runtime/shared";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { createWorkspaceEntityAndBootstrapEvents } from "../common/support/realtimeServiceEvents.js";


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

    const inviteId = normalizeRecordId(event?.entityId, { fallback: null });
    if (!inviteId) {
      return [];
    }

    const row = await knex("workspace_invites as wi")
      .join("users as up", "up.email", "wi.email")
      .where("wi.id", inviteId)
      .first("up.id as user_id");

    const userId = normalizeDbRecordId(row?.user_id, { fallback: null });
    if (!userId) {
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
    "users.workspace.members.service",
    (scope) => {
      const appConfig = resolveAppConfig(scope);
      return createWorkspaceMembersService({
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        inviteExpiresInMs: resolveWorkspaceMembersInviteExpiresInMs(appConfig),
        roleCatalog: createWorkspaceRoleCatalog(appConfig),
        workspaceInvitationsEnabled: scope.make("users.workspace.invitations.enabled") === true
      });
    },
    {
      events: deepFreeze({
        updateMemberRole: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "member",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: "workspace.members.changed"
        }),
        removeMember: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "member",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: "workspace.members.changed"
        }),
        createInvite: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "invite",
          workspaceOperation: "created",
          workspaceRealtimeEvent: "workspace.invites.changed",
          bootstrapEntityId: ({ result }) => result?.createdInviteId,
          bootstrapAudience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
        }),
        revokeInvite: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "invite",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: "workspace.invites.changed",
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
        workspaceMembersService: "users.workspace.members.service"
      }
    })
  );
}

export { registerWorkspaceMembers };
