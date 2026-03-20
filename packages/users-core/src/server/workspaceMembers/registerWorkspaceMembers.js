import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";
import { materializeWorkspaceActionSurfacesFromAppConfig } from "../support/workspaceActionSurfaces.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN } from "../common/diTokens.js";

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
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceInvitationsEnabled =
    typeof app.has === "function" && app.has(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN)
      ? app.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN) === true
      : false;

  app.service(
    USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN,
    (scope) => {
      const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
      return createWorkspaceMembersService({
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        inviteExpiresInMs: resolveWorkspaceMembersInviteExpiresInMs(appConfig),
        roleCatalog: createWorkspaceRoleCatalog(appConfig)
      });
    },
    {
      events: deepFreeze({
        updateMemberRole: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "member",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_MEMBERS_CHANGED_EVENT,
              payload: ({ args }) => ({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "event_scope"
            }
          }
        ],
        removeMember: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "member",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_MEMBERS_CHANGED_EVENT,
              payload: ({ args }) => ({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "event_scope"
            }
          }
        ],
        createInvite: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "created",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
              payload: ({ args }) => ({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ result }) => result?.createdInviteId,
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
            }
          }
        ],
        revokeInvite: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
              payload: ({ args }) => ({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ args }) => args?.[1],
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
            }
          }
        ]
      })
    }
  );

  const actions = workspaceInvitationsEnabled
    ? workspaceMembersActions
    : workspaceMembersActions.filter((action) => {
        const actionId = String(action?.id || "").trim().toLowerCase();
        return actionId !== "workspace.invites.list" &&
          actionId !== "workspace.invite.create" &&
          actionId !== "workspace.invite.revoke";
      });

  app.actions(
    materializeWorkspaceActionSurfacesFromAppConfig(
      withActionDefaults(actions, {
        domain: "workspace",
        dependencies: {
          workspaceMembersService: USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN
        }
      }),
      { appConfig }
    )
  );
}

export { registerWorkspaceMembers };
