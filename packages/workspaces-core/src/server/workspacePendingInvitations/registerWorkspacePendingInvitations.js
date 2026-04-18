import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";

function workspaceAudienceFromEntityId({ event } = {}) {
  const workspaceId = normalizeRecordId(event?.entityId, { fallback: null });
  if (!workspaceId) {
    return "none";
  }
  return {
    workspaceId
  };
}

function actorUserEntityId({ options } = {}) {
  return normalizeRecordId(options?.context?.actor?.id, { fallback: "" });
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
    entityId: ({ result }) => normalizeRecordId(result?.workspaceId, { fallback: "" }),
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
      realtimeEvent: "workspace.invitations.pending.changed"
    }),
    createActorUserEvent({
      source: "users",
      entity: "bootstrap",
      realtimeEvent: "users.bootstrap.changed"
    })
  ];

  if (includeDirectoryAndMembers) {
    events.push(
      createActorUserEvent({
        source: "workspace",
        entity: "directory",
        realtimeEvent: "workspaces.changed"
      }),
      createWorkspaceAudienceEvent({
        entity: "member",
        realtimeEvent: "workspace.members.changed"
      })
    );
  }

  events.push(
    createWorkspaceAudienceEvent({
      entity: "invite",
      realtimeEvent: "workspace.invites.changed"
    })
  );

  return events;
}

function registerWorkspacePendingInvitations(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspacePendingInvitations requires application singleton()/service()/actions().");
  }

  app.service(
    "workspaces.pending-invitations.service",
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
        workspacePendingInvitationsService: "workspaces.pending-invitations.service"
      }
    })
  );
}

export { registerWorkspacePendingInvitations };
