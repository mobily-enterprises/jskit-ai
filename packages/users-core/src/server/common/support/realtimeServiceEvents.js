import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";

function resolveActorScopedEntityId({ context } = {}) {
  return context?.actor?.id;
}

const ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS = Object.freeze([
  createEntityChangedActionEvent({
    source: "account",
    entity: "settings",
    operation: "updated",
    entityId: resolveActorScopedEntityId,
    realtime: {
      event: "account.settings.changed",
      audience: "actor_user"
    }
  }),
  createEntityChangedActionEvent({
    source: "users",
    entity: "bootstrap",
    operation: "updated",
    entityId: resolveActorScopedEntityId,
    realtime: {
      event: "users.bootstrap.changed",
      audience: "actor_user"
    }
  })
]);

export { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS };
