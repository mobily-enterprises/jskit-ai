import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";

test("shared workspace settings resource declares workspace_id as the resource id column", () => {
  assert.equal(workspaceSettingsResource.idProperty, "workspace_id");
  assert.equal(workspaceSettingsResource.schema.id?.storage?.column, "workspace_id");
});
