import {
  currentQueryInputValidator,
  startCommandInputValidator,
  grantCommandInputValidator,
  closeCommandInputValidator,
  currentStateOutputValidator,
  startGateOutputValidator,
  grantRewardOutputValidator,
  closeSessionOutputValidator
} from "./inputSchemas.js";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";

const ACTION_CURRENT = "rewarded.current.read";
const ACTION_START = "rewarded.start";
const ACTION_GRANT = "rewarded.grant";
const ACTION_CLOSE = "rewarded.close";

const watchSessionChanged = resolveCrudRecordChangedEvent("rewarded_watch_sessions");
const unlockReceiptChanged = resolveCrudRecordChangedEvent("rewarded_unlock_receipts");

function changedEvent({ entity, operation, entityId, event }) {
  return createEntityChangedActionEvent({
    source: "rewarded",
    entity,
    operation,
    entityId,
    realtime: { event, audience: "event_scope" }
  });
}

/** @param {{ rewarded: import("./types.js").RewardedCore }} dependencies */
function createRewardedActions({ rewarded }) {
  return Object.freeze([
    Object.freeze({
      id: ACTION_CURRENT,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: ["app"],
      permission: { require: "authenticated" },
      input: currentQueryInputValidator,
      output: currentStateOutputValidator,
      idempotency: "none",
      execute: (input, context) => rewarded.getCurrentState(input, { context })
    }),
    Object.freeze({
      id: ACTION_START,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["app"],
      permission: { require: "authenticated" },
      input: startCommandInputValidator,
      output: startGateOutputValidator,
      idempotency: "optional",
      events: [changedEvent({
        entity: "watch-session",
        operation: "created",
        entityId: ({ result }) => result?.session?.id,
        event: watchSessionChanged
      })],
      execute: (input, context) => rewarded.startGate(input, { context })
    }),
    Object.freeze({
      id: ACTION_GRANT,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["app"],
      permission: { require: "authenticated" },
      input: grantCommandInputValidator,
      output: grantRewardOutputValidator,
      idempotency: "optional",
      events: [
        changedEvent({
          entity: "watch-session",
          operation: "updated",
          entityId: ({ result }) => result?.session?.id,
          event: watchSessionChanged
        }),
        changedEvent({
          entity: "unlock-receipt",
          operation: "created",
          entityId: ({ result }) => result?.unlock?.id,
          event: unlockReceiptChanged
        })
      ],
      execute: (input, context) => rewarded.grantReward(input, { context })
    }),
    Object.freeze({
      id: ACTION_CLOSE,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["app"],
      permission: { require: "authenticated" },
      input: closeCommandInputValidator,
      output: closeSessionOutputValidator,
      idempotency: "optional",
      events: [changedEvent({
        entity: "watch-session",
        operation: "updated",
        entityId: ({ result }) => result?.session?.id,
        event: watchSessionChanged
      })],
      execute: (input, context) => rewarded.closeSession(input, { context })
    })
  ]);
}

export {
  ACTION_CURRENT,
  ACTION_START,
  ACTION_GRANT,
  ACTION_CLOSE,
  createRewardedActions
};
