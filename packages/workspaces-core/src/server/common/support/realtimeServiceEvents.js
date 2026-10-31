import { normalizeDbRecordId } from "@jskit-ai/database-runtime/shared";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspace } from "../../support/resolveWorkspace.js";

function resultValue({ result } = {}) {
  return result?.value ?? result ?? {};
}

function actorId({ context } = {}) {
  return context?.actor?.id;
}

function workspaceId(execution = {}) {
  return resolveWorkspace(execution.context, execution.input)?.id || resultValue(execution)?.workspaceId;
}

function workspaceSlugPayload(execution = {}) {
  return {
    workspaceSlug: String(
      resolveWorkspace(execution.context, execution.input)?.slug || execution.input?.workspaceSlug || ""
    ).trim()
  };
}

const INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE = Object.freeze({
  preset: "event_scope",
  /** @param {{ knex: import("knex").Knex, event: { entityId?: unknown } }} input */
  async userQuery({ knex, event }) {
    const inviteId = normalizeRecordId(event?.entityId, { fallback: null });
    if (!inviteId) return [];
    const row = await knex("workspace_invites as wi")
      .join("users as up", "up.email", "wi.email")
      .where("wi.id", inviteId)
      .first("up.id as user_id");
    const userId = normalizeDbRecordId(row?.user_id, { fallback: null });
    return userId ? [{ userId }] : [];
  }
});

/**
 * @param {object} event
 * @param {string} event.workspaceEntity
 * @param {string} event.workspaceOperation
 * @param {string} event.workspaceRealtimeEvent
 * @param {typeof workspaceId} [event.bootstrapEntityId]
 * @param {string} [event.bootstrapAudience]
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
    entityId: ({ result }) => result?.value?.workspaceId ?? result?.workspaceId,
    realtime: {
      event: realtimeEvent,
      audience: ({ result }) => ({ workspaceId: result?.value?.workspaceId ?? result?.workspaceId })
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
  INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE,
  createInviteDecisionEvents,
  createWorkspaceEntityAndBootstrapEvents
};
