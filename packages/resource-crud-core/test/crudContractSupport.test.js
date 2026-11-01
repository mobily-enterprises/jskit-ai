import test from "node:test";
import assert from "node:assert/strict";
import {
  isCrudRuntimeOutputOnlyFieldKey
} from "../src/shared/crudLookup.js";

test("isCrudRuntimeOutputOnlyFieldKey matches lookups", () => {
  assert.equal(isCrudRuntimeOutputOnlyFieldKey("lookups"), true);
  assert.equal(isCrudRuntimeOutputOnlyFieldKey(" lookups "), true);
  assert.equal(isCrudRuntimeOutputOnlyFieldKey("id"), false);
});

test("isCrudRuntimeOutputOnlyFieldKey supports custom lookup container key", () => {
  assert.equal(
    isCrudRuntimeOutputOnlyFieldKey("lookupData", {
      lookupContainerKey: "lookupData"
    }),
    true
  );
  assert.equal(
    isCrudRuntimeOutputOnlyFieldKey("lookups", {
      lookupContainerKey: "lookupData"
    }),
    false
  );
});
