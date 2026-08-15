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

const ACTION_CURRENT = "google-rewarded.current.read";
const ACTION_START = "google-rewarded.start";
const ACTION_GRANT = "google-rewarded.grant";
const ACTION_CLOSE = "google-rewarded.close";

const watchSessionChanged = resolveCrudRecordChangedEvent("google_rewarded_watch_sessions");
const unlockReceiptChanged = resolveCrudRecordChangedEvent("google_rewarded_unlock_receipts");

function changedEvent({ entity, operation, entityId, event }) {
  return createEntityChangedActionEvent({
    source: "google-rewarded",
    entity,
    operation,
    entityId,
    realtime: { event, audience: "event_scope" }
  });
}

function createGoogleRewardedActions({ googleRewarded } = {}) {
  if (!googleRewarded) {
    throw new TypeError("createGoogleRewardedActions requires googleRewarded.");
  }
  return Object.freeze([
  {
    id: ACTION_CURRENT,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    permission: { require: "authenticated" },
    input: currentQueryInputValidator,
    output: currentStateOutputValidator,
    idempotency: "none",
    audit: {
      actionName: ACTION_CURRENT
    },
    observability: {},
    async execute(input, context) {
      return googleRewarded.getCurrentState(input, {
        context
      });
    }
  },
  {
    id: ACTION_START,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    permission: { require: "authenticated" },
    input: startCommandInputValidator,
    output: startGateOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START
    },
    observability: {},
    events: [changedEvent({
      entity: "watch-session",
      operation: "created",
      entityId: ({ result }) => result?.session?.id,
      event: watchSessionChanged
    })],
    async execute(input, context) {
      return googleRewarded.startGate(input, {
        context
      });
    }
  },
  {
    id: ACTION_GRANT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    permission: { require: "authenticated" },
    input: grantCommandInputValidator,
    output: grantRewardOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_GRANT
    },
    observability: {},
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
    async execute(input, context) {
      return googleRewarded.grantReward(input, {
        context
      });
    }
  },
  {
    id: ACTION_CLOSE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    permission: { require: "authenticated" },
    input: closeCommandInputValidator,
    output: closeSessionOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CLOSE
    },
    observability: {},
    events: [changedEvent({
      entity: "watch-session",
      operation: "updated",
      entityId: ({ result }) => result?.session?.id,
      event: watchSessionChanged
    })],
    async execute(input, context) {
      return googleRewarded.closeSession(input, {
        context
      });
    }
  }
  ]);
}

export {
  ACTION_CURRENT,
  ACTION_START,
  ACTION_GRANT,
  ACTION_CLOSE,
  createGoogleRewardedActions
};
