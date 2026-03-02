import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublishRequestMeta,
  normalizeHeaderValue,
  publishSafely,
  resolvePublishMethod,
  warnPublishFailure
} from "../src/server/realtimePublish.js";

test("publishSafely returns false when publish method is missing", () => {
  const result = publishSafely({
    publishMethod: null,
    payload: {
      eventType: "workspace.meta.updated"
    }
  });

  assert.equal(result, false);
});

test("publishSafely invokes publish method and returns true on success", () => {
  let receivedPayload = null;
  const result = publishSafely({
    publishMethod(payload) {
      receivedPayload = payload;
    },
    payload: {
      eventType: "workspace.meta.updated"
    }
  });

  assert.equal(result, true);
  assert.deepEqual(receivedPayload, {
    eventType: "workspace.meta.updated"
  });
});

test("publishSafely warns and returns false when publish throws", () => {
  const warnings = [];
  const error = new Error("fanout failed");
  const result = publishSafely({
    publishMethod() {
      throw error;
    },
    payload: {
      eventType: "workspace.meta.updated"
    },
    request: {
      log: {
        warn(payload, message) {
          warnings.push([payload, message]);
        }
      }
    },
    logCode: "workspace.realtime.publish_failed",
    logContext: {
      workspaceId: 11
    }
  });

  assert.equal(result, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0].err, error);
  assert.equal(warnings[0][0].workspaceId, 11);
  assert.equal(warnings[0][1], "workspace.realtime.publish_failed");
});

test("publishSafely handles thrown publish when warn logger is unavailable", () => {
  const result = publishSafely({
    publishMethod() {
      throw new Error("publish exploded");
    },
    payload: {
      eventType: "workspace.meta.updated"
    },
    request: {}
  });

  assert.equal(result, false);
});

test("warnPublishFailure merges logContext object fields and falls back log code", () => {
  const warnings = [];
  const error = new Error("publish failed");

  warnPublishFailure({
    request: {
      log: {
        warn(payload, message) {
          warnings.push([payload, message]);
        }
      }
    },
    error,
    logCode: "",
    logContext: {
      topic: "projects",
      workspaceId: 11
    }
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0].err, error);
  assert.equal(warnings[0][0].topic, "projects");
  assert.equal(warnings[0][0].workspaceId, 11);
  assert.equal(warnings[0][1], "realtime.publish_failed");
});

test("normalizeHeaderValue trims strings and handles blank/non-string values", () => {
  assert.equal(normalizeHeaderValue("  cmd_1 "), "cmd_1");
  assert.equal(normalizeHeaderValue("   "), null);
  assert.equal(normalizeHeaderValue(123), "123");
  assert.equal(normalizeHeaderValue(false), null);
  assert.equal(normalizeHeaderValue(undefined), null);
});

test("buildPublishRequestMeta normalizes headers and preserves actorUserId as provided", () => {
  assert.deepEqual(
    buildPublishRequestMeta({
      headers: {
        "x-command-id": " cmd_99 ",
        "x-client-id": " client_2 "
      },
      user: {
        id: "7"
      }
    }),
    {
      commandId: "cmd_99",
      sourceClientId: "client_2",
      actorUserId: "7"
    }
  );
});

test("resolvePublishMethod returns function only when method exists", () => {
  const realtimeEventsService = {
    publishWorkspaceEvent() {}
  };

  assert.equal(resolvePublishMethod(realtimeEventsService, "publishWorkspaceEvent"), realtimeEventsService.publishWorkspaceEvent);
  assert.equal(resolvePublishMethod(realtimeEventsService, "missingMethod"), null);
  assert.equal(resolvePublishMethod(null, "publishWorkspaceEvent"), null);
  assert.equal(resolvePublishMethod(realtimeEventsService, null), null);
});
