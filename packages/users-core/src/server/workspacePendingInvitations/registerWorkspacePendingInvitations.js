import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACES_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
} from "../common/diTokens.js";

function workspaceAudienceFromEntityId({ event } = {}) {
  const workspaceId = Number(event?.entityId);
  if (!Number.isInteger(workspaceId) || workspaceId < 1) {
    return "none";
  }
  return {
    workspaceId
  };
}

function actorUserEntityId({ options } = {}) {
  return Number(options?.context?.actor?.id || 0);
}

function createActorUserEvent({ source, entity, realtimeEvent }) {
  return {
    type: "entity.changed",
    source,
    entity,
    operation: "updated",
    entityId: actorUserEntityId,
    realtime: {
      event: realtimeEvent,
      audience: "actor_user"
    }
  };
}

function createWorkspaceAudienceEvent({ entity, realtimeEvent }) {
  return {
    type: "entity.changed",
    source: "workspace",
    entity,
    operation: "updated",
    entityId: ({ result }) => result?.workspaceId,
    realtime: {
      event: realtimeEvent,
      audience: workspaceAudienceFromEntityId
    }
  };
}

function createInviteDecisionEvents({ includeDirectoryAndMembers = false } = {}) {
  const events = [
    createActorUserEvent({
      source: "workspace",
      entity: "invitation",
      realtimeEvent: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
    }),
    createActorUserEvent({
      source: "users",
      entity: "bootstrap",
      realtimeEvent: USERS_BOOTSTRAP_CHANGED_EVENT
    })
  ];

  if (includeDirectoryAndMembers) {
    events.push(
      createActorUserEvent({
        source: "workspace",
        entity: "directory",
        realtimeEvent: WORKSPACES_CHANGED_EVENT
      }),
      createWorkspaceAudienceEvent({
        entity: "member",
        realtimeEvent: WORKSPACE_MEMBERS_CHANGED_EVENT
      })
    );
  }

  events.push(
    createWorkspaceAudienceEvent({
      entity: "invite",
      realtimeEvent: WORKSPACE_INVITES_CHANGED_EVENT
    })
  );

  return events;
}

function registerWorkspacePendingInvitations(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspacePendingInvitations requires application singleton()/service()/actions().");
  }

  app.service(
    USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
    (scope) =>
      createService({
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository")
      }),
    {
      events: deepFreeze({
        acceptInviteByToken: createInviteDecisionEvents({
          includeDirectoryAndMembers: true
        }),
        refuseInviteByToken: createInviteDecisionEvents()
      })
    }
  );

  app.actions(
    withActionDefaults(workspacePendingInvitationsActions, {
      domain: "workspace",
      dependencies: {
        workspacePendingInvitationsService: USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
      }
    })
  );
}

export { registerWorkspacePendingInvitations };
