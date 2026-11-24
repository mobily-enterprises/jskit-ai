import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";
import { crudJsonApiActionOptions } from "./support/crudJsonApiActionOptions.js";

// What an assistant or a remote client reads about each generated action: a delete says it is destructive, a feature's
// assistantHints add to its generated changes, and a custom action without a description of its own is described by
// its route's summary.

const notes = defineTableResource({
  name: "notes",
  tableName: "notes",
  ownership: "workspace",
  schema: { workspaceId: { type: "id", storage: { column: "workspace_id" } }, title: { type: "string", required: true } }
});
const crud = defineCrudContract(notes, {
  namespace: "notes",
  fields: { title: { output: "required", create: "required", patch: "optional" } }
});
const orderInput = Object.freeze({ schema: createSchema({ orderedIds: { type: "array", required: true, items: { type: "id" } } }), mode: "create" });

function definitionsWith(actions, options = {}) {
  const definitions = createCrudJsonApiActions(crudJsonApiActionOptions({
    namespace: "notes",
    resource: crud,
    service: {},
    surface: "admin",
    permissionForOperation: () => ({ require: "authenticated" }),
    actions,
    ...options
  }));
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

test("a generated delete is marked destructive and no other generated operation is", () => {
  const byId = definitionsWith({});
  assert.equal(byId.get("crud.notes.delete").extensions.assistant.destructive, true);
  for (const operation of ["list", "view", "create", "update"]) {
    assert.equal(byId.get(`crud.notes.${operation}`).extensions.assistant.destructive, false, operation);
  }
});

test("a feature's assistantHints mark its generated changes, and a hint it cannot have stops it", () => {
  const byId = definitionsWith({}, { assistantHints: { create: { sendsOutside: true }, update: { destructive: true } } });
  assert.equal(byId.get("crud.notes.update").extensions.assistant.destructive, true);
  assert.equal(byId.get("crud.notes.create").extensions.assistant.sendsOutside, true);
  assert.equal(byId.get("crud.notes.create").extensions.assistant.destructive, false);
  assert.equal(byId.get("crud.notes.update").extensions.assistant.description, "Update a notes record.", "the generated extension stays");
  assert.equal(typeof byId.get("crud.notes.update").extensions.assistant.transformResult, "function");
  for (const [hints, pattern] of [
    [[], /assistantHints maps create, update or delete/u],
    [{ list: { destructive: true } }, /assistantHints\.list: hints are for the feature's own create, update or delete/u],
    [{ update: true }, /assistantHints\.update must be/u],
    [{ update: { destructive: "yes" } }, /assistantHints\.update\.destructive: a hint is destructive or sendsOutside, true or false/u],
    [{ update: { readOnly: true } }, /assistantHints\.update\.readOnly/u]
  ]) {
    assert.throws(() => definitionsWith({}, { assistantHints: hints }), pattern, JSON.stringify(hints));
  }
  assert.throws(() => definitionsWith({}, { operations: ["list", "view"], assistantHints: { update: { destructive: true } } }),
    /assistantHints\.update: hints are for the feature's own/u, "an operation the feature does not have");
});

test("a custom action is described by its route's summary unless it describes itself, and keeps its own hints", () => {
  const route = (summary) => ({ method: "POST", path: "/reorder", contract: { body: orderInput }, statusCode: 200, summary });
  const byId = definitionsWith({
    reorder: { input: orderInput, execute: async () => ({}), route: route("Persist the complete note order.") },
    archive: {
      input: orderInput,
      execute: async () => ({}),
      route: route("Archive notes."),
      extensions: { assistant: { description: "Archive the given notes for good.", destructive: true } }
    },
    tidy: { input: orderInput, execute: async () => ({}) }
  });
  assert.equal(byId.get("crud.notes.reorder").extensions.assistant.description, "Persist the complete note order.");
  assert.deepEqual(byId.get("crud.notes.archive").extensions.assistant, { description: "Archive the given notes for good.", destructive: true });
  assert.equal(byId.get("crud.notes.tidy").extensions.assistant, undefined, "without a route or description it says nothing");
});
