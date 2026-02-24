import assert from "node:assert/strict";
import test from "node:test";
import {
  __testables,
  deleteRowsOlderThan,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow,
  normalizeDeletedRowCount
} from "../src/retention.js";

function createFakeClient({ ids = [{ id: 1 }, { id: 2 }], deleted = 2 } = {}) {
  const calls = {
    where: [],
    orderBy: [],
    limit: [],
    select: [],
    whereIn: [],
    del: []
  };

  const selectQuery = {
    orderBy(column, direction) {
      calls.orderBy.push([column, direction]);
      return this;
    },
    limit(value) {
      calls.limit.push(value);
      return this;
    },
    async select(column) {
      calls.select.push(column);
      return ids;
    }
  };

  const query = {
    where(column, operator, value) {
      calls.where.push([column, operator, value]);
      return selectQuery;
    },
    whereIn(column, value) {
      calls.whereIn.push([column, value]);
      return {
        async del() {
          calls.del.push(value);
          return deleted;
        }
      };
    }
  };

  const client = (tableName) => {
    void tableName;
    return query;
  };

  return { client, calls };
}

test("retention normalizers keep legacy semantics", () => {
  assert.equal(normalizeBatchSize("not-int"), 1000);
  assert.equal(normalizeBatchSize(20_000), 10_000);
  assert.equal(normalizeBatchSize(5), 5);

  assert.equal(normalizeCutoffDateOrThrow("2024-01-01T00:00:00.000Z").toISOString(), "2024-01-01T00:00:00.000Z");
  assert.throws(() => normalizeCutoffDateOrThrow("bad-date"), /Invalid cutoff date\./);

  assert.equal(normalizeDeletedRowCount(2), 2);
  assert.equal(normalizeDeletedRowCount("3"), 3);
  assert.equal(normalizeDeletedRowCount(-1), 0);
  assert.equal(normalizeDeletedRowCount(NaN), 0);

  assert.equal(__testables.normalizeBatchSize(9), 9);
});

test("deleteRowsOlderThan serializes cutoff, clamps limit, and applies filters", async () => {
  const { client, calls } = createFakeClient({ ids: [{ id: "1" }, { id: 2 }], deleted: "2" });
  let applyFiltersCalled = false;

  const deleted = await deleteRowsOlderThan({
    client,
    tableName: "items",
    dateColumn: "created_at",
    cutoffDate: "2024-01-02T03:04:05.006Z",
    batchSize: 20_000,
    applyFilters(query) {
      applyFiltersCalled = true;
      return query;
    }
  });

  assert.equal(applyFiltersCalled, true);
  assert.equal(calls.where[0][0], "created_at");
  assert.equal(calls.where[0][1], "<");
  assert.equal(calls.where[0][2], "2024-01-02 03:04:05.006");
  assert.equal(calls.limit[0], 10_000);
  assert.deepEqual(calls.whereIn[0], ["id", [1, 2]]);
  assert.equal(deleted, 2);
});

test("deleteRowsOlderThan returns zero for empty/invalid id batches", async () => {
  const emptyResult = await deleteRowsOlderThan({
    client: createFakeClient({ ids: [] }).client,
    tableName: "items",
    dateColumn: "created_at",
    cutoffDate: "2024-01-02T03:04:05.006Z"
  });
  assert.equal(emptyResult, 0);

  const invalidIdsResult = await deleteRowsOlderThan({
    client: createFakeClient({ ids: [{ id: "x" }, { id: 0 }] }).client,
    tableName: "items",
    dateColumn: "created_at",
    cutoffDate: "2024-01-02T03:04:05.006Z"
  });
  assert.equal(invalidIdsResult, 0);
});
