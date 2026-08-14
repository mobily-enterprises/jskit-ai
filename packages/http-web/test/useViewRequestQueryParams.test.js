import assert from "node:assert/strict";
import test from "node:test";
import { buildRequestQueryObject } from "../src/client/composables/support/requestQueryRuntimeSupport.js";

test("buildRequestQueryObject preserves repeated keys as arrays deterministically", () => {
  assert.deepEqual(
    buildRequestQueryObject([
      { key: "include", values: ["vetId", "linkedUserId", "pets", "pets.breedId"] },
      { key: "limit", values: ["10"] }
    ]),
    {
      include: ["vetId", "linkedUserId", "pets", "pets.breedId"],
      limit: "10"
    }
  );
});

test("buildRequestQueryObject returns an empty object when no request params are active", () => {
  assert.deepEqual(buildRequestQueryObject([]), {});
});
