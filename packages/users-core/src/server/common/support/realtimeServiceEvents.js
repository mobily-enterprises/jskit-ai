import {
  ACCOUNT_SETTINGS_CHANGED_EVENT,
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "../../../shared/events/usersEvents.js";
import { deepFreeze } from "./deepFreeze.js";

function resolveActorScopedEntityId({ options } = {}) {
  return Number(options?.context?.actor?.id || 0);
}

function resolveWorkspaceSlugPayload({ args } = {}) {
  return {
    workspaceSlug: String(args?.[0]?.slug || "").trim()
  };
}

const ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS = deepFreeze([
  {
    type: "entity.changed",
    source: "account",
    entity: "settings",
    operation: "updated",
    entityId: resolveActorScopedEntityId,
    realtime: {
      event: ACCOUNT_SETTINGS_CHANGED_EVENT,
      audience: "actor_user"
    }
  },
  {
    type: "entity.changed",
    source: "users",
    entity: "bootstrap",
    operation: "updated",
    entityId: resolveActorScopedEntityId,
    realtime: {
      event: USERS_BOOTSTRAP_CHANGED_EVENT,
      audience: "actor_user"
    }
  }
]);

function createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity,
  workspaceOperation,
  workspaceRealtimeEvent,
  workspaceEntityId = ({ args }) => args?.[0]?.id,
  bootstrapEntityId = ({ args }) => args?.[0]?.id,
  bootstrapAudience = "event_scope"
} = {}) {
  const normalizedWorkspaceEntity = String(workspaceEntity || "").trim();
  const normalizedWorkspaceOperation = String(workspaceOperation || "")
    .trim()
    .toLowerCase();
  const normalizedWorkspaceRealtimeEvent = String(workspaceRealtimeEvent || "").trim();
  if (!normalizedWorkspaceEntity || !normalizedWorkspaceOperation || !normalizedWorkspaceRealtimeEvent) {
    throw new Error(
      "createWorkspaceEntityAndBootstrapEvents requires workspaceEntity, workspaceOperation, and workspaceRealtimeEvent."
    );
  }
  if (typeof workspaceEntityId !== "function") {
    throw new Error("createWorkspaceEntityAndBootstrapEvents requires workspaceEntityId to be a function.");
  }
  if (typeof bootstrapEntityId !== "function") {
    throw new Error("createWorkspaceEntityAndBootstrapEvents requires bootstrapEntityId to be a function.");
  }

  return deepFreeze([
    {
      type: "entity.changed",
      source: "workspace",
      entity: normalizedWorkspaceEntity,
      operation: normalizedWorkspaceOperation,
      entityId: workspaceEntityId,
      realtime: {
        event: normalizedWorkspaceRealtimeEvent,
        payload: resolveWorkspaceSlugPayload,
        audience: "event_scope"
      }
    },
    {
      type: "entity.changed",
      source: "users",
      entity: "bootstrap",
      operation: "updated",
      entityId: bootstrapEntityId,
      realtime: {
        event: USERS_BOOTSTRAP_CHANGED_EVENT,
        audience: bootstrapAudience
      }
    }
  ]);
}

export { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS, createWorkspaceEntityAndBootstrapEvents };
