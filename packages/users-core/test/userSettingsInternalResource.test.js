import assert from "node:assert/strict";
import test from "node:test";
import { userSettingsResource as internalUserSettingsResource } from "../src/server/common/resources/userSettingsResource.js";

test("internal user settings resource declares user_id as the resource id column", () => {
  assert.equal(internalUserSettingsResource.idProperty, "user_id");
  assert.equal(internalUserSettingsResource.schema.id?.storage?.column, "user_id");
});
