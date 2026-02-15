import assert from "node:assert/strict";
import test from "node:test";
import { __testables, createAnnuityHistoryService } from "../services/annuityHistoryService.js";

function makeResult(overrides = {}) {
  return {
    mode: "pv",
    timing: "ordinary",
    payment: 500,
    annualRate: 6,
    annualGrowthRate: 3,
    years: 20,
    paymentsPerYear: 12,
    periodicRate: 0.005,
    periodicGrowthRate: 0.002466269772,
    totalPeriods: 240,
    isPerpetual: false,
    value: 87059.287,
    ...overrides
  };
}

test("appendCalculation persists schema-valid history entry", async () => {
  const inserts = [];
  const service = createAnnuityHistoryService({
    calculationLogsRepository: {
      async insert(userId, entry) {
        inserts.push({ userId, entry });
      }
    }
  });

  const historyEntry = await service.appendCalculation(77, makeResult());

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].userId, 77);
  assert.deepEqual(inserts[0].entry, historyEntry);
  assert.match(historyEntry.id, /^[0-9a-f-]{36}$/);
  assert.equal(historyEntry.mode, "pv");
  assert.equal(historyEntry.timing, "ordinary");
});

test("appendCalculation throws if generated history entry violates schema", async () => {
  const service = createAnnuityHistoryService({
    calculationLogsRepository: {
      async insert() {
        throw new Error("should not insert invalid data");
      }
    }
  });

  await assert.rejects(
    () =>
      service.appendCalculation(
        77,
        makeResult({
          mode: "invalid-mode"
        })
      ),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.message, "Internal history entry validation failed.");
      assert.equal(Boolean(error.details?.fieldErrors?.mode), true);
      return true;
    }
  );
});

test("history entry validation rejects malformed createdAt and uuid", () => {
  const historyEntry = __testables.buildHistoryEntryFromResult(makeResult());
  historyEntry.createdAt = "2026-02-15T10:00:00Z";
  historyEntry.id = "not-a-uuid";

  assert.throws(
    () => {
      __testables.assertValidHistoryEntry(historyEntry);
    },
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.message, "Internal history entry validation failed.");
      assert.equal(Boolean(error.details?.fieldErrors?.createdAt), true);
      assert.equal(Boolean(error.details?.fieldErrors?.id), true);
      return true;
    }
  );
});
