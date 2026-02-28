import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_IDS } from "@jskit-ai/action-runtime-core/actionIds";
import { delay } from "../../../../tests/helpers/delay.js";
import { createSocialOutboxWorkerRuntimeService } from "../src/shared/outboxWorkerRuntime.service.js";

async function waitFor(predicate, { timeoutMs = 300, intervalMs = 5 } = {}) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(intervalMs);
  }
}

test("createSocialOutboxWorkerRuntimeService returns no-op runtime when disabled", () => {
  const runtime = createSocialOutboxWorkerRuntimeService({
    enabled: false,
    federationEnabled: true
  });

  runtime.start();
  assert.equal(runtime.isStarted(), false);
  runtime.stop();
});

test("createSocialOutboxWorkerRuntimeService validates required dependencies when enabled", () => {
  assert.throws(
    () =>
      createSocialOutboxWorkerRuntimeService({
        enabled: true,
        federationEnabled: true,
        actionExecutor: null,
        socialRepository: {
          outboxDeliveries: {
            async listReadyWorkspaceIds() {
              return [];
            }
          }
        }
      }),
    /actionExecutor\.execute is required/
  );
});

test("createSocialOutboxWorkerRuntimeService dispatches one action per ready workspace", async () => {
  const calls = [];
  const runtime = createSocialOutboxWorkerRuntimeService({
    enabled: true,
    federationEnabled: true,
    actionExecutor: {
      async execute(payload) {
        calls.push(payload);
      }
    },
    socialRepository: {
      outboxDeliveries: {
        async listReadyWorkspaceIds() {
          return [4, "bad", 7];
        }
      }
    },
    logger: {
      info() {},
      warn() {}
    },
    pollSeconds: 60,
    workspaceBatchSize: 10
  });

  runtime.start();
  await waitFor(() => calls.length === 2);
  runtime.stop();

  assert.deepEqual(
    calls.map((entry) => entry.input.workspaceId),
    [4, 7]
  );
  assert.equal(calls[0].actionId, ACTION_IDS.SOCIAL_FEDERATION_OUTBOX_DELIVERIES_PROCESS);
  assert.equal(calls[0].context.channel, "worker");
});
