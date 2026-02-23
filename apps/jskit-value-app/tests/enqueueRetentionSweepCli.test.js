import assert from "node:assert/strict";
import test from "node:test";

import { buildEnqueueOutput, parseCliArgs } from "../server/workers/enqueueRetentionSweepCli.js";

test("enqueue retention CLI parses supported flags", () => {
  const parsed = parseCliArgs(["--dry-run", "--trigger=cron", "--requested-by=systemd", "--idempotency-key=my-key"]);

  assert.deepEqual(parsed, {
    dryRun: true,
    trigger: "cron",
    requestedBy: "systemd",
    idempotencyKey: "my-key"
  });
});

test("enqueue retention CLI output reports normalized/enqueued idempotency key when present", () => {
  const output = buildEnqueueOutput({
    queueName: "ops.retention",
    dryRun: true,
    job: {
      id: "retention-cron-2026-02-21-dry-run",
      data: {
        idempotencyKey: "cron-2026-02-21-dry-run"
      }
    }
  });

  assert.deepEqual(output, {
    queue: "ops.retention",
    jobId: "retention-cron-2026-02-21-dry-run",
    dryRun: true,
    idempotencyKey: "cron-2026-02-21-dry-run",
    idempotencyApplied: true
  });
});

test("enqueue retention CLI output reports idempotency as not applied when queue payload has no key", () => {
  const output = buildEnqueueOutput({
    queueName: "ops.retention",
    dryRun: false,
    job: {
      id: "42",
      data: {}
    }
  });

  assert.deepEqual(output, {
    queue: "ops.retention",
    jobId: "42",
    dryRun: false,
    idempotencyKey: "",
    idempotencyApplied: false
  });
});
