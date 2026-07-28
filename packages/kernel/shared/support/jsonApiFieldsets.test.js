import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeJsonApiFieldList,
  normalizeJsonApiFieldsets,
  buildJsonApiFieldsetsToken
} from "./jsonApiFieldsets.js";

test("JSON:API fieldsets normalize comma lists into a stable typed map", () => {
  assert.deepEqual(
    normalizeJsonApiFieldsets({
      jobs: ["status", "id,status"],
      contacts: "displayName,id"
    }),
    {
      contacts: ["displayName", "id"],
      jobs: ["id", "status"]
    }
  );
  assert.deepEqual(normalizeJsonApiFieldList(["name", "", "id,name"]), ["id", "name"]);
});

test("JSON:API fieldsets produce deterministic query tokens", () => {
  const fieldsets = {
    jobs: ["status", "id"],
    contacts: ["id"]
  };

  assert.equal(
    buildJsonApiFieldsetsToken(fieldsets),
    buildJsonApiFieldsetsToken({
      contacts: ["id"],
      jobs: ["id", "status"]
    })
  );
  assert.equal(buildJsonApiFieldsetsToken({}), "");
});

test("JSON:API fieldset resource types cannot mutate object prototypes", () => {
  const fieldsets = normalizeJsonApiFieldsets(
    Object.fromEntries([
      ["__proto__", ["id", "name"]]
    ])
  );

  assert.equal(Object.getPrototypeOf(fieldsets), Object.prototype);
  assert.equal(Object.hasOwn(fieldsets, "__proto__"), true);
  assert.deepEqual(fieldsets.__proto__, ["id", "name"]);
});
