import { jsonApiResultValue } from "@jskit-ai/http-runtime/shared";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { resolveWorkspace } from "../../support/resolveWorkspace.js";

function actorId({ context }) {
  return resolveActorId(context);
}

function workspaceId(execution = {}) {
  return resolveWorkspace(execution.context, execution.input)?.id || jsonApiResultValue(execution.result)?.workspaceId;
}

function workspaceSlugPayload(execution = {}) {
  return {
    workspaceSlug: String(
      resolveWorkspace(execution.context, execution.input)?.slug || execution.input?.workspaceSlug || ""
    ).trim()
  };
}

/**
 * The audience of an invite's bootstrap change: the event's scope and the
 * user the invite's email belongs to, when one has signed up.
 * @param {Pick<import("../../types.js").WorkspaceMembersService, "inviteRecipientUserIds">} dependencies
 */
function createInviteRecipientBootstrapAudience({ inviteRecipientUserIds }) {
  /** @param {{ event: { entityId?: unknown }, options: { context?: object } }} input */
  function audienceUsers({ event, options }) {
    return inviteRecipientUserIds(event.entityId, options);
  }

  return Object.freeze({
    preset: "event_scope",
    audienceUsers
  });
}

/**
 * @param {object} event
 * @param {string} event.workspaceEntity
 * @param {string} event.workspaceOperation
 * @param {string} event.workspaceRealtimeEvent
 * @param {typeof workspaceId} [event.bootstrapEntityId]
 * @param {string | object} [event.bootstrapAudience]
 */
function createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity,
  workspaceOperation,
  workspaceRealtimeEvent,
  bootstrapEntityId = workspaceId,
  bootstrapAudience = "event_scope"
}) {
  return Object.freeze([
    createEntityChangedActionEvent({
      source: "workspace",
      entity: workspaceEntity,
      operation: workspaceOperation,
      entityId: workspaceId,
      realtime: {
        event: workspaceRealtimeEvent,
        audience: "event_scope",
        payload: workspaceSlugPayload
      }
    }),
    createEntityChangedActionEvent({
      source: "users",
      entity: "bootstrap",
      operation: "updated",
      entityId: bootstrapEntityId,
      realtime: {
        event: "users.bootstrap.changed",
        audience: bootstrapAudience
      }
    })
  ]);
}

/** @param {{ source: string, entity: string, realtimeEvent: string }} event */
function createActorEvent({ source, entity, realtimeEvent }) {
  return createEntityChangedActionEvent({
    source,
    entity,
    operation: "updated",
    entityId: actorId,
    realtime: { event: realtimeEvent, audience: "actor_user" }
  });
}

/** @param {{ entity: string, realtimeEvent: string }} event */
function createWorkspaceAudienceEvent({ entity, realtimeEvent }) {
  return createEntityChangedActionEvent({
    source: "workspace",
    entity,
    operation: "updated",
    entityId: ({ result }) => jsonApiResultValue(result).workspaceId,
    realtime: {
      event: realtimeEvent,
      audience: ({ result }) => ({ workspaceId: jsonApiResultValue(result).workspaceId })
    }
  });
}

function onlyAccepted(builder) {
  return (execution) => execution.input?.decision === "accept" ? builder(execution) : null;
}

function createInviteDecisionEvents() {
  return Object.freeze([
    createActorEvent({
      source: "workspace",
      entity: "invitation",
      realtimeEvent: "workspace.invitations.pending.changed"
    }),
    createActorEvent({
      source: "users",
      entity: "bootstrap",
      realtimeEvent: "users.bootstrap.changed"
    }),
    onlyAccepted(createActorEvent({
      source: "workspace",
      entity: "directory",
      realtimeEvent: "workspaces.changed"
    })),
    onlyAccepted(createWorkspaceAudienceEvent({
      entity: "member",
      realtimeEvent: "workspace.members.changed"
    })),
    createWorkspaceAudienceEvent({
      entity: "invite",
      realtimeEvent: "workspace.invites.changed"
    })
  ]);
}

export {
  createInviteRecipientBootstrapAudience,
  createInviteDecisionEvents,
  createWorkspaceEntityAndBootstrapEvents
};
