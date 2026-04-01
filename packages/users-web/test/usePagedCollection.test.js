import assert from "node:assert/strict";
import test from "node:test";
import { trimInfinitePagesToFirst } from "../src/client/composables/usePagedCollection.js";

test("trimInfinitePagesToFirst leaves non-object payloads untouched", () => {
  assert.equal(trimInfinitePagesToFirst(null), null);
  assert.equal(trimInfinitePagesToFirst(""), "");
  assert.equal(trimInfinitePagesToFirst(12), 12);
});

test("trimInfinitePagesToFirst leaves single-page payload unchanged", () => {
  const payload = Object.freeze({
    pages: Object.freeze([{ items: [1, 2] }]),
    pageParams: Object.freeze([null])
  });

  assert.equal(trimInfinitePagesToFirst(payload), payload);
});

test("trimInfinitePagesToFirst truncates to the first page and first pageParam", () => {
  const payload = {
    pages: [
      { items: [1, 2] },
      { items: [3, 4] },
      { items: [5, 6] }
    ],
    pageParams: [null, "cursor-1", "cursor-2"],
    extra: true
  };

  assert.deepEqual(
    trimInfinitePagesToFirst(payload),
    {
      pages: [{ items: [1, 2] }],
      pageParams: [null],
      extra: true
    }
  );
});

test("trimInfinitePagesToFirst injects null pageParam when missing", () => {
  const payload = {
    pages: [{ items: [1] }, { items: [2] }]
  };

  assert.deepEqual(
    trimInfinitePagesToFirst(payload),
    {
      pages: [{ items: [1] }],
      pageParams: [null]
    }
  );
});
