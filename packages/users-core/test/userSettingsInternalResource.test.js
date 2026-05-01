import assert from "node:assert/strict";
import test from "node:test";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";

test("shared user settings resource declares user_id as the resource id column", () => {
  assert.equal(userSettingsResource.idProperty, "user_id");
  assert.equal(userSettingsResource.schema.id?.storage?.column, "user_id");
});
