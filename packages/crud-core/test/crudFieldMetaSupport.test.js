import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCrudLookupFormControl,
  isCrudRuntimeOutputOnlyFieldKey
} from "../src/shared/crudFieldMetaSupport.js";

test("checkCrudLookupFormControl defaults to autocomplete", () => {
  assert.equal(checkCrudLookupFormControl(undefined), "autocomplete");
  assert.equal(checkCrudLookupFormControl(""), "autocomplete");
});

test("checkCrudLookupFormControl accepts select", () => {
  assert.equal(checkCrudLookupFormControl("select"), "select");
});

test("checkCrudLookupFormControl accepts explicit empty default", () => {
  assert.equal(checkCrudLookupFormControl(undefined, { defaultValue: "" }), "");
});

test("checkCrudLookupFormControl throws for invalid value", () => {
  assert.throws(
    () => checkCrudLookupFormControl("Select", { context: "testContext" }),
    /testContext must be "autocomplete" or "select"\./
  );
});

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
