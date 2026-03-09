import assert from "node:assert/strict";
import test from "node:test";
import { schema as workspaceSchema } from "../src/shared/schema/workspaceSchema.js";

test("workspace schema exports required resource contract for workspace settings", () => {
  const contract = workspaceSchema.resourceContracts.workspaceSettings;
  assert.ok(contract);
  assert.equal(typeof contract, "object");
  assert.equal(typeof contract.record, "object");
  assert.equal(typeof contract.create, "object");
  assert.equal(typeof contract.replace, "object");
  assert.equal(typeof contract.patch, "object");
  assert.equal(typeof contract.list, "object");
  assert.deepEqual(contract.required.create, ["name", "color", "invitesEnabled"]);
  assert.deepEqual(contract.required.replace, ["name", "color", "invitesEnabled"]);
  assert.deepEqual(contract.required.patch, []);
});

test("workspace settings update body uses patch schema from resource contract", () => {
  const contract = workspaceSchema.resourceContracts.workspaceSettings;
  assert.equal(workspaceSchema.body.settingsUpdate, contract.patch);
});
