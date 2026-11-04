import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useViewCore } from "../src/client/composables/runtime/useViewCore.js";

test("useViewCore prefers resource isInitialLoading/isFetching signals when provided", () => {
  const resource = {
    data: ref({ id: 42 }),
    isInitialLoading: ref(false),
    isFetching: ref(true),
    query: {
      isPending: ref(true),
      isFetching: ref(true),
      error: ref(null)
    },
    loadError: ref("")
  };

  const view = useViewCore({
    resource
  });

  assert.equal(view.isLoading.value, false);
  assert.equal(view.isFetching.value, true);
});
