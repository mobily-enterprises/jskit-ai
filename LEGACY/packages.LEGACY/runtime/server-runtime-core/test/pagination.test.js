import assert from "node:assert/strict";
import test from "node:test";
import { normalizePagination } from "../src/server/pagination.js";

test("normalizePagination uses defaults for invalid inputs", () => {
  assert.deepEqual(normalizePagination({}), {
    page: 1,
    pageSize: 20
  });

  assert.deepEqual(normalizePagination({ page: 0, pageSize: -1 }), {
    page: 1,
    pageSize: 20
  });
});

test("normalizePagination clamps pageSize to configured max", () => {
  assert.deepEqual(normalizePagination({ page: 2, pageSize: 500 }, { maxPageSize: 100 }), {
    page: 2,
    pageSize: 100
  });

  assert.deepEqual(
    normalizePagination({ page: 3, pageSize: 2 }, { defaultPage: 9, defaultPageSize: 25, maxPageSize: 50 }),
    {
      page: 3,
      pageSize: 2
    }
  );
});
