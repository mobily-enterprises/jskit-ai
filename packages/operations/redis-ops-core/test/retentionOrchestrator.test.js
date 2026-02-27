import assert from "node:assert/strict";
import test from "node:test";

import { createRetentionSweepOrchestrator } from "../src/shared/retentionOrchestrator.js";

test("retention orchestrator executes rules in order and aggregates summary totals", async () => {
  const calls = [];
  const orchestrator = createRetentionSweepOrchestrator({
    retentionConfig: {
      logRetentionDays: 30,
      inviteRetentionDays: 90,
      batchSize: 500
    },
    rules: [
      {
        id: "console_errors",
        retentionConfigKey: "logRetentionDays",
        async deleteBatch({ batchSize }) {
          calls.push(`console:${batchSize}`);
          return calls.length === 1 ? 500 : 5;
        }
      },
      {
        id: "workspace_invites",
        retentionConfigKey: "inviteRetentionDays",
        async execute({ batchSize }) {
          calls.push(`invite:${batchSize}`);
          return {
            totalDeletedRows: 12,
            batches: 1
          };
        }
      }
    ],
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  const summary = await orchestrator.runSweep();

  assert.equal(summary.batchSize, 500);
  assert.equal(summary.totalDeletedRows, 517);
  assert.equal(summary.failedRuleCount, 0);
  assert.equal(summary.rules.length, 2);
  assert.deepEqual(calls, ["console:500", "console:500", "invite:500"]);
  assert.equal(summary.rules[0].ruleId, "console_errors");
  assert.equal(summary.rules[0].deletedRows, 505);
  assert.equal(summary.rules[1].ruleId, "workspace_invites");
  assert.equal(summary.rules[1].deletedRows, 12);
});

test("retention orchestrator dry run skips delete execution", async () => {
  let deleteCalls = 0;
  const orchestrator = createRetentionSweepOrchestrator({
    rules: [
      {
        id: "dry_rule",
        retentionDays: 14,
        async deleteBatch() {
          deleteCalls += 1;
          return 5;
        },
        async buildDryRunMetadata() {
          return {
            mode: "preview"
          };
        }
      }
    ],
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  const summary = await orchestrator.runSweep({ dryRun: true });
  assert.equal(deleteCalls, 0);
  assert.equal(summary.totalDeletedRows, 0);
  assert.equal(summary.rules[0].dryRun, true);
  assert.deepEqual(summary.rules[0].dryRunMeta, { mode: "preview" });
});

test("retention orchestrator can continue with partial failures when failFast is disabled", async () => {
  const orchestrator = createRetentionSweepOrchestrator({
    failFast: false,
    rules: [
      {
        id: "healthy_rule",
        retentionDays: 30,
        async deleteBatch() {
          return 4;
        }
      },
      {
        id: "failing_rule",
        retentionDays: 30,
        async deleteBatch() {
          throw Object.assign(new Error("boom"), { code: "RULE_FAIL" });
        }
      }
    ],
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  const summary = await orchestrator.runSweep();
  assert.equal(summary.totalDeletedRows, 4);
  assert.equal(summary.failedRuleCount, 1);
  assert.equal(summary.rules[0].failed, false);
  assert.equal(summary.rules[1].failed, true);
  assert.deepEqual(summary.rules[1].error, {
    code: "RULE_FAIL",
    message: "boom"
  });
});
