import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { hasResolvedQueryData } from "../src/client/composables/support/resourceLoadStateHelpers.js";

test("hasResolvedQueryData returns true when the query succeeded", () => {
  const query = {
    isSuccess: ref(true)
  };

  assert.equal(hasResolvedQueryData({
    query,
    data: ref(null)
  }), true);
});

test("hasResolvedQueryData returns true when data payload is available", () => {
  const query = {
    isSuccess: ref(false)
  };

  assert.equal(hasResolvedQueryData({
    query,
    data: ref({
      id: 2971
    })
  }), true);
});

test("hasResolvedQueryData returns false when query and payload are unresolved", () => {
  const query = {
    isSuccess: ref(false)
  };

  assert.equal(hasResolvedQueryData({
    query,
    data: ref(null)
  }), false);
});
