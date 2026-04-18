import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { deepFreeze } from "./deepFreeze.js";

function resolveActorScopedEntityId({ options } = {}) {
  return normalizeRecordId(options?.context?.actor?.id, { fallback: "" });
}

const ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS = deepFreeze([
  {
    type: "entity.changed",
    source: "account",
    entity: "settings",
    operation: "updated",
    entityId: resolveActorScopedEntityId,
    realtime: {
      event: "account.settings.changed",
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
      event: "users.bootstrap.changed",
      audience: "actor_user"
    }
  }
]);

export { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS };
