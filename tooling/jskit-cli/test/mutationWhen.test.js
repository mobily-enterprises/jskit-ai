import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMutationWhen, shouldApplyMutationWhen } from "../src/server/cliRuntime/mutationWhen.js";

test("normalizeMutationWhen preserves hasText conditions", () => {
  assert.deepEqual(
    normalizeMutationWhen({
      option: "route-prefix",
      hasText: true
    }),
    {
      all: [],
      any: [],
      option: "route-prefix",
      config: "",
      equals: "",
      notEquals: "",
      contains: "",
      notContains: "",
      includes: [],
      excludes: [],
      hasText: true
    }
  );
});

test("shouldApplyMutationWhen supports text-presence checks for options", () => {
  const when = {
    option: "route-prefix",
    hasText: true
  };

  assert.equal(
    shouldApplyMutationWhen(when, {
      options: {
        "route-prefix": "admin/booking-engine"
      }
    }),
    true
  );

  assert.equal(
    shouldApplyMutationWhen(when, {
      options: {
        "route-prefix": ""
      }
    }),
    false
  );

  assert.equal(
    shouldApplyMutationWhen(when, {
      options: {}
    }),
    false
  );
});
