import assert from "node:assert/strict";
import test from "node:test";
import { __testables, createAnnuityHistoryService } from "../server/modules/history/service.js";

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
  const workspaceId = 12;
  const userId = 77;
  const service = createAnnuityHistoryService({
    calculationLogsRepository: {
      async insert(nextWorkspaceId, nextUserId, entry) {
        inserts.push({ workspaceId: nextWorkspaceId, userId: nextUserId, entry });
      }
    }
  });

  const historyEntry = await service.appendCalculation(workspaceId, userId, makeResult());

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].workspaceId, workspaceId);
  assert.equal(inserts[0].userId, userId);
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
        12,
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

test("listForUser returns mapped entries with username and clamps page to totalPages", async () => {
  const workspaceId = 19;
  const service = createAnnuityHistoryService({
    calculationLogsRepository: {
      async countForWorkspaceUser(nextWorkspaceId, userId) {
        assert.equal(nextWorkspaceId, workspaceId);
        assert.equal(userId, 15);
        return 25;
      },
      async listForWorkspaceUser(nextWorkspaceId, userId, page, pageSize) {
        assert.equal(nextWorkspaceId, workspaceId);
        assert.equal(userId, 15);
        assert.equal(page, 3);
        assert.equal(pageSize, 10);
        return [
          {
            id: "entry-1",
            createdAt: "2026-02-16T10:00:00.000Z",
            mode: "pv",
            timing: "ordinary",
            payment: "500.000000",
            annualRate: "6.000000",
            annualGrowthRate: "0.000000",
            years: "20.0000",
            paymentsPerYear: 12,
            periodicRate: "0.005000000000",
            periodicGrowthRate: "0.000000000000",
            totalPeriods: "240.0000",
            isPerpetual: false,
            value: "100000.000000000000"
          }
        ];
      }
    }
  });

  const result = await service.listForUser(
    workspaceId,
    { id: 15, displayName: "seed.user1" },
    {
      page: 99,
      pageSize: 10
    }
  );

  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
  assert.equal(result.total, 25);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].username, "seed.user1");
});

test("listForUser handles empty history with minimum one page", async () => {
  const workspaceId = 7;
  const service = createAnnuityHistoryService({
    calculationLogsRepository: {
      async countForWorkspaceUser(nextWorkspaceId, userId) {
        assert.equal(nextWorkspaceId, workspaceId);
        assert.equal(userId, 21);
        return 0;
      },
      async listForWorkspaceUser(nextWorkspaceId, userId, page, pageSize) {
        assert.equal(nextWorkspaceId, workspaceId);
        assert.equal(userId, 21);
        assert.equal(page, 1);
        assert.equal(pageSize, 10);
        return [];
      }
    }
  });

  const result = await service.listForUser(
    workspaceId,
    { id: 21, displayName: "seed.user2" },
    {
      page: 5,
      pageSize: 10
    }
  );

  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.total, 0);
  assert.deepEqual(result.entries, []);
});

test("buildHistoryEntryFromResult preserves null horizon fields", () => {
  const entry = __testables.buildHistoryEntryFromResult(
    makeResult({
      years: null,
      totalPeriods: null,
      isPerpetual: true
    })
  );

  assert.equal(entry.years, null);
  assert.equal(entry.totalPeriods, null);
  assert.equal(entry.isPerpetual, true);
});

test("mapSchemaErrorsToFieldErrors handles empty paths and missing messages", () => {
  const mapped = __testables.mapSchemaErrorsToFieldErrors([
    {
      path: "",
      message: ""
    },
    {
      path: "/mode",
      message: "Expected 'pv' or 'fv'"
    }
  ]);

  assert.equal(mapped.historyEntry, "Invalid value.");
  assert.equal(mapped.mode, "Expected 'pv' or 'fv'");
});

test("mapSchemaErrorsToFieldErrors supports instancePath fallback", () => {
  const mapped = __testables.mapSchemaErrorsToFieldErrors([
    {
      instancePath: "/payment",
      message: "must be number"
    },
    {
      message: "fallback"
    },
    {
      path: null,
      instancePath: null,
      message: ""
    }
  ]);

  assert.equal(mapped.payment, "must be number");
  assert.equal(mapped.historyEntry, "fallback");
});
