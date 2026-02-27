import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_IDS } from "@jskit-ai/action-runtime-core/actionIds";
import { createSocialOutboxWorkerRuntimeService } from "@jskit-ai/social-core/outboxWorkerRuntimeService";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate, { timeoutMs = 300, intervalMs = 5 } = {}) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(intervalMs);
  }
}

test("social outbox worker runtime returns disabled no-op service when federation worker is off", () => {
  const workerRuntime = createSocialOutboxWorkerRuntimeService({
    enabled: true,
    federationEnabled: false
  });

  assert.equal(typeof workerRuntime.start, "function");
  assert.equal(typeof workerRuntime.stop, "function");
  assert.equal(typeof workerRuntime.isStarted, "function");

  workerRuntime.start();
  assert.equal(workerRuntime.isStarted(), false);
  workerRuntime.stop();
});

test("social outbox worker runtime validates required dependencies when enabled", () => {
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

test("social outbox worker runtime dispatches delivery action per ready workspace", async () => {
  const calls = [];
  const workerRuntime = createSocialOutboxWorkerRuntimeService({
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
          return [7, 12];
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

  workerRuntime.start();
  await waitFor(() => calls.length === 2);
  workerRuntime.stop();

  assert.equal(workerRuntime.isStarted(), false);
  assert.deepEqual(
    calls.map((entry) => entry.input.workspaceId),
    [7, 12]
  );
  assert.equal(calls[0].actionId, ACTION_IDS.SOCIAL_FEDERATION_OUTBOX_DELIVERIES_PROCESS);
  assert.equal(calls[0].context.channel, "worker");
  assert.equal(calls[0].context.surface, "app");
});

test("social outbox worker runtime fails one workspace without blocking later workspaces", async () => {
  const attemptedWorkspaceIds = [];
  const warningEntries = [];

  const workerRuntime = createSocialOutboxWorkerRuntimeService({
    enabled: true,
    federationEnabled: true,
    actionExecutor: {
      async execute(payload) {
        const workspaceId = Number(payload?.input?.workspaceId || 0);
        attemptedWorkspaceIds.push(workspaceId);
        if (workspaceId === 3) {
          throw new Error("forced delivery failure");
        }
      }
    },
    socialRepository: {
      outboxDeliveries: {
        async listReadyWorkspaceIds() {
          return [3, "invalid", 4];
        }
      }
    },
    logger: {
      info() {},
      warn(payload, message) {
        warningEntries.push({
          payload,
          message
        });
      }
    },
    pollSeconds: 60,
    workspaceBatchSize: 10
  });

  workerRuntime.start();
  await waitFor(() => attemptedWorkspaceIds.includes(4));
  workerRuntime.stop();

  assert.deepEqual(attemptedWorkspaceIds, [3, 4]);
  assert.equal(
    warningEntries.some((entry) => entry.message === "social.worker.outbox.workspace_failed"),
    true
  );
});
