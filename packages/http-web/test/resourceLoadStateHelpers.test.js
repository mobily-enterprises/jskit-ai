import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import {
  buildRequestRecoveryMeta,
  hasResolvedQueryData,
  mergeQueryMeta,
  mergeRequestRecoveryQueryMeta
} from "../src/client/composables/support/resourceLoadStateHelpers.js";

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

test("mergeQueryMeta preserves caller metadata while adding JSKIT refresh policy", () => {
  assert.deepEqual(
    mergeQueryMeta(
      {
        staleTime: 1000,
        meta: {
          owner: "contacts",
          jskit: {
            feature: "list"
          }
        }
      },
      {
        jskit: {
          refreshOnPull: true
        }
      }
    ),
    {
      staleTime: 1000,
      meta: {
        owner: "contacts",
        jskit: {
          feature: "list",
          refreshOnPull: true
        }
      }
    }
  );
});

test("request recovery query metadata supports labels and disabling recovery", () => {
  assert.deepEqual(
    buildRequestRecoveryMeta("Project access"),
    {
      jskit: {
        requestRecoveryLabel: "Project access"
      }
    }
  );

  assert.deepEqual(
    buildRequestRecoveryMeta(false),
    {
      jskit: {
        requestRecovery: false
      }
    }
  );
});

test("mergeRequestRecoveryQueryMeta preserves caller metadata while adding recovery hints", () => {
  assert.deepEqual(
    mergeRequestRecoveryQueryMeta(
      {
        staleTime: 5000,
        meta: {
          owner: "project-access",
          jskit: {
            refreshOnPull: true
          }
        }
      },
      {
        label: "Project access",
        source: "app.project-access",
        dedupeKey: "project-access",
        method: "get",
        dedupeWindowMs: 100
      }
    ),
    {
      staleTime: 5000,
      meta: {
        owner: "project-access",
        jskit: {
          refreshOnPull: true,
          requestRecoveryLabel: "Project access",
          requestRecoverySource: "app.project-access",
          requestRecoveryDedupeKey: "project-access",
          requestRecoveryMethod: "GET",
          requestRecoveryDedupeWindowMs: 100
        }
      }
    }
  );
});

test("mergeRequestRecoveryQueryMeta does not overwrite explicit query recovery labels with defaults", () => {
  assert.deepEqual(
    mergeRequestRecoveryQueryMeta(
      {
        meta: {
          jskit: {
            requestRecoveryLabel: "Explicit label",
            requestRecoveryMethod: "HEAD",
            requestRecoveryDedupeWindowMs: 0
          }
        }
      },
      null,
      {
        label: "Default label",
        method: "GET",
        dedupeWindowMs: 5000
      }
    ),
    {
      meta: {
        jskit: {
          requestRecoveryLabel: "Explicit label",
          requestRecoveryMethod: "HEAD",
          requestRecoveryDedupeWindowMs: 0
        }
      }
    }
  );
});

test("mergeRequestRecoveryQueryMeta preserves disabled recovery metadata", () => {
  assert.deepEqual(
    mergeRequestRecoveryQueryMeta(
      {
        meta: {
          jskit: {
            requestRecovery: false
          }
        }
      },
      null,
      {
        label: "Default label",
        method: "GET"
      }
    ),
    {
      meta: {
        jskit: {
          requestRecovery: false
        }
      }
    }
  );
});
