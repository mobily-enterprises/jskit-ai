import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract, isCrudContract } from "../src/shared/crudContract.js";

const contactResource = defineTableResource({
  name: "contacts",
  tableName: "contacts",
  ownership: "public",
  schema: {
    name: { type: "string", maxLength: 190, required: true },
    createdAt: { type: "dateTime", readOnly: true }
  }
});

function contactsCrud(overrides = {}) {
  return defineCrudContract(contactResource, {
    contract: { lookup: { containerKey: "lookups" } },
    messages: { validation: "Fix invalid values." },
    ...overrides
  });
}

const idOutput = createSchema({ id: { type: "string", required: true, minLength: 1 } });

test("a CRUD contract derives the standard operations, on its resource, with its messages", async () => {
  const crud = contactsCrud();

  assert.equal(isCrudContract(crud), true);
  assert.equal(isCrudContract({ ...crud }), false);
  assert.equal(crud.resource, contactResource);
  assert.equal(crud.namespace, "contacts");
  assert.deepEqual(Object.keys(crud.operations), ["list", "view", "create", "patch", "delete"]);
  assert.deepEqual(crud.operations.list.realtime?.events, ["contacts.record.changed"]);
  assert.equal(crud.operations.view.messages, crud.messages);
  assert.equal(Object.isFrozen(crud), true);

  const createBody = await validateSchemaPayload(crud.operations.create.body, { name: "  Example  " }, { phase: "input" });
  assert.equal(createBody.name, "Example");

  const viewOutput = await validateSchemaPayload(crud.operations.view.output, {
    id: 7,
    name: " Example ",
    createdAt: "2026-05-01T12:30:00.000Z",
    lookups: {}
  }, { phase: "output" });
  assert.equal(viewOutput.id, "7");
  assert.equal(viewOutput.name, "Example");
  assert.equal(viewOutput.createdAt, "2026-05-01T12:30:00.000Z");
});

test("a CRUD contract offers the operations it names, once each", () => {
  const crud = contactsCrud({ operations: ["list", "view", "create", "view"] });

  assert.deepEqual(Object.keys(crud.operations), ["list", "view", "create"]);
  assert.throws(() => contactsCrud({ operations: ["list", "archive"] }), /operations must be among: list, view, create, replace, patch, delete/u);
  assert.throws(() => contactsCrud({ operations: "list" }), /operations must be an array of CRUD operation names/u);
});

test("the namespace defaults to the resource's name and can be given", () => {
  assert.equal(contactsCrud({ namespace: "address-book" }).namespace, "address-book");
  assert.deepEqual(contactsCrud({ namespace: "address-book" }).operations.list.realtime?.events, ["address_book.record.changed"]);
  assert.equal(contactsCrud().apiAccess, undefined);
  assert.equal(contactsCrud({ apiAccess: "public" }).apiAccess, "public");
});

test("explicit outputs and bodies win, and replace takes the body", async () => {
  const crud = contactsCrud({
    namespace: "userProfile",
    operations: ["view", "create", "replace", "patch"],
    output: createSchema({
      id: { type: "string", required: true, minLength: 1 },
      name: { type: "string", required: true, minLength: 1 }
    }),
    body: createSchema({ name: { type: "string", required: true, minLength: 1 } })
  });

  assert.deepEqual(Object.keys(crud.operations), ["view", "create", "replace", "patch"]);
  assert.equal(crud.operations.replace.body.mode, "replace");
  const replaceBody = await validateSchemaPayload(crud.operations.replace.body, { name: " Example " }, { phase: "input" });
  assert.equal(replaceBody.name, "Example");
});

test("an explicit list item output builds the list output", () => {
  const crud = contactsCrud({
    operations: ["list", "view"],
    output: idOutput,
    listItemOutput: createSchema({
      id: { type: "string", required: true },
      label: { type: "string", required: true }
    })
  });

  assert.equal(crud.operations.list.output.schema.toJsonSchema({ mode: "replace" }).properties.items.type, "array");
});

test("a list-only contract needs no record output", () => {
  const crud = defineCrudContract(contactResource, {
    namespace: "contactAudit",
    operations: ["list"],
    listItemOutput: createSchema({ id: { type: "string", required: true } })
  });

  assert.deepEqual(Object.keys(crud.operations), ["list"]);
});

test("a contract fails fast when an operation it offers cannot be derived", () => {
  const settings = defineTableResource({ name: "assistantSettings", tableName: "assistant_settings", ownership: "public", schema: { secret: { type: "string", hidden: true } } });

  assert.throws(
    () => defineCrudContract(settings, { operations: ["view", "patch"], patchBody: createSchema({ prompt: { type: "string" } }) }),
    /derived output requires an explicit output or at least one field with an output operation/u
  );
  assert.throws(
    () => defineCrudContract(settings, { operations: ["patch"], output: idOutput }),
    /derived patch body requires an explicit patchBody or at least one field with a patch operation/u
  );
});

test("a contract is built on a table resource and takes only the CRUD keys", () => {
  assert.throws(() => defineCrudContract({ name: "contacts", tableName: "contacts", schema: {} }, {}), /requires a table resource from defineTableResource/u);
  assert.throws(() => contactsCrud({ tableName: "contacts" }), /does not take tableName\. A CRUD contract takes namespace, apiAccess, operations, fields/u);
  assert.throws(() => contactsCrud({ crudOperations: ["list"] }), /does not take crudOperations/u);
  assert.throws(() => contactsCrud({ contract: { response: { defaultExclude: ["notes"] } } }), /contract\.response belongs to the table resource: its defaultExclude/u);
});
