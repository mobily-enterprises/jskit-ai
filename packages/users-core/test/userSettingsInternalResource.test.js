import assert from "node:assert/strict";
import test from "node:test";
import { userSettingsTableResource } from "../src/shared/resources/userSettingsResource.js";

test("shared user settings resource declares user_id as the resource id column", () => {
  assert.equal(userSettingsTableResource.idProperty, "user_id");
  assert.equal(userSettingsTableResource.schema.id?.storage?.column, "user_id");
});
