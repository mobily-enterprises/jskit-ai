import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { defineCrudContract } from "../src/shared/crudContract.js";

// A built contract's operations as JSON: each schema as its field definitions, each function as its source.
function builtJson(operations) {
  return JSON.stringify(operations, (key, value) => {
    if (value && typeof value.getFieldDefinitions === "function") {
      return { fields: value.getFieldDefinitions(), mode: value.mode };
    }
    return typeof value === "function" ? String(value) : value;
  });
}

function defineNotes(schema, fields = undefined) {
  const resource = defineTableResource({ name: "notes", tableName: "notes", ownership: "public", schema });
  return defineCrudContract(resource, fields === undefined ? { namespace: "notes" } : { namespace: "notes", fields });
}

const NOTE_FIELDS = Object.freeze({
  title: { type: "string", required: true, maxLength: 190 },
  body: { type: "string", nullable: true },
  // A column added to the table after the contract was written.
  internalNote: { type: "string", nullable: true }
});

const NOTE_ENTRIES = Object.freeze({
  title: { output: "required", create: "required", patch: "optional", replace: "required" },
  body: { output: "optional", create: "optional", patch: "optional", replace: "optional" }
});

const fieldsOf = (operation) => Object.keys(operation.schema.getFieldDefinitions());

test("a contract shows and accepts only the fields it names: its output and bodies refuse a field it does not name", () => {
  const resource = defineTableResource({ name: "notes", tableName: "notes", ownership: "public", schema: NOTE_FIELDS });
  const contract = defineCrudContract(resource, {
    namespace: "notes",
    operations: ["list", "view", "create", "replace", "patch"],
    fields: NOTE_ENTRIES
  });
  assert.deepEqual(fieldsOf(contract.operations.view.output), ["id", "title", "body"]);
  for (const operation of ["create", "replace", "patch"]) {
    assert.deepEqual(fieldsOf(contract.operations[operation].body), ["title", "body"], operation);
    assert.throws(
      () => validateSchemaPayload(contract.operations[operation].body, { title: "Notes", internalNote: "staff only" }, { phase: "input" }),
      (error) => Object.hasOwn(error.fieldErrors || {}, "internalNote"),
      `${operation} accepts internalNote`
    );
  }
  assert.throws(() => validateSchemaPayload(contract.operations.view.output, {
    id: "1",
    title: "Notes",
    body: null,
    internalNote: "staff only"
  }, { phase: "output" }), (error) => Object.hasOwn(error.fieldErrors || {}, "internalNote"));
});

test("without an entry only a stored createdAt or updatedAt takes part, as output; read-only, hidden and primary fields take nothing", () => {
  const contract = defineNotes({
    id: { type: "id", primary: true },
    title: { type: "string", required: true },
    ownerId: { type: "id", required: true, hidden: true },
    total: { type: "integer", readOnly: true },
    createdAt: { type: "dateTime", storage: { column: "created_at", writeSerializer: "datetime-utc" } }
  }, { title: { output: "required", create: "required", patch: "optional" } });
  assert.deepEqual(fieldsOf(contract.operations.view.output), ["id", "title", "createdAt"]);
  assert.equal(contract.operations.view.output.schema.getFieldDefinitions().id.type, "string");
  assert.deepEqual(fieldsOf(contract.operations.create.body), ["title"]);
  assert.deepEqual(fieldsOf(contract.operations.patch.body), ["title"]);
});

test("a contract that names no field for an operation it offers is refused, saying so", () => {
  assert.throws(() => defineNotes({ title: { type: "string", required: true } }),
    /derived output requires an explicit output or at least one field with an output operation: a contract shows only the fields its fields name/u);
  assert.throws(() => defineNotes({ title: { type: "string", required: true } }, { title: { output: "required" } }),
    /derived create body requires an explicit createBody or at least one field with a create operation: a contract accepts only the fields its fields name/u);
});

test("stored createdAt and updatedAt take output only, and a contract that would let a request write them is refused", () => {
  const schema = {
    title: { type: "string", required: true },
    createdAt: { type: "dateTime", storage: { column: "created_at", writeSerializer: "datetime-utc" } },
    updatedAt: { type: "dateTime", storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
  };
  const title = { title: { output: "required", create: "required", patch: "optional" } };
  const contract = defineNotes(schema, title);
  assert.deepEqual(fieldsOf(contract.operations.view.output), ["id", "title", "createdAt", "updatedAt"]);
  assert.deepEqual(fieldsOf(contract.operations.create.body), ["title"]);
  assert.deepEqual(fieldsOf(contract.operations.patch.body), ["title"]);
  assert.throws(() => defineNotes(schema, { ...title, updatedAt: { output: "required", patch: "optional" } }),
    /defineCrudContract\(notes\) fields\.updatedAt takes updatedAt, which the handle stamps on every write/u);
  assert.throws(() => defineNotes(schema, { ...title, createdAt: { create: "optional" } }), /fields\.createdAt takes createdAt/u);
  const resource = defineTableResource({ name: "notes", tableName: "notes", ownership: "public", schema });
  assert.throws(() => defineCrudContract(resource, {
    namespace: "notes",
    fields: title,
    patchBody: createSchema({ title: { type: "string" }, updatedAt: { type: "dateTime" } })
  }), /defineCrudContract\(notes\) patch body takes updatedAt/u);
});

test("a field's entry is exactly what it takes part in, merged over its definition", () => {
  const contract = defineNotes({
    title: { type: "string", required: true },
    placementId: { type: "id", nullable: true },
    ownerId: { type: "id", required: true, hidden: true }
  }, {
    title: { output: "required", create: "required" },
    placementId: { output: {}, create: {}, patch: {} },
    ownerId: { output: { required: true } }
  });
  const output = contract.operations.view.output.schema.getFieldDefinitions();
  const create = contract.operations.create.body.schema.getFieldDefinitions();
  assert.equal(output.placementId.required, undefined);
  assert.equal(create.placementId.required, undefined);
  assert.equal(output.ownerId.required, true);
  assert.equal(Object.hasOwn(create, "ownerId"), false);
  assert.deepEqual(Object.keys(contract.operations.patch.body.schema.getFieldDefinitions()), ["placementId"]);
});

test("an entry writes required and optional as words, or true for the field as it is", () => {
  const words = defineNotes(NOTE_FIELDS, {
    title: { output: "required", create: "required", patch: "optional" },
    body: { output: true, create: "optional", patch: "optional" }
  });
  const objects = defineNotes(NOTE_FIELDS, {
    title: { output: { required: true }, create: { required: true }, patch: { required: false } },
    body: { output: true, create: { required: false }, patch: { required: false } }
  });
  assert.equal(builtJson(words.operations), builtJson(objects.operations));
  assert.equal(words.operations.view.output.schema.getFieldDefinitions().body.nullable, true);
});

test("an entry names fields of the resource and the field operations only", () => {
  assert.throws(() => defineNotes(NOTE_FIELDS, { missing: { output: "required" } }), /fields\.missing is not a field of the notes resource/u);
  assert.throws(() => defineNotes(NOTE_FIELDS, { title: { list: "required" } }), /fields\.title\.list is not a field operation; use output, create, patch, replace/u);
  assert.throws(() => defineNotes(NOTE_FIELDS, { title: { output: "maybe" } }), /fields\.title\.output must be "required", "optional", true or an object/u);
  assert.throws(() => defineNotes(NOTE_FIELDS, { title: "required" }), /fields\.title must be an object of operations/u);
});

test("a lookup field builds the same operations as its expanded form", () => {
  const entries = {
    title: { output: "required", create: "required", patch: "optional" },
    divisionId: { output: "required", create: "optional", patch: "optional" }
  };
  const compact = defineNotes({
    title: { type: "string", required: true },
    divisionId: { type: "id", nullable: true, search: true, lookup: "organisation-units" }
  }, entries);
  const explicit = defineNotes({
    title: { type: "string", required: true },
    divisionId: {
      type: "id",
      nullable: true,
      search: true,
      relation: { kind: "lookup", namespace: "organisation-units", valueKey: "id" },
      belongsTo: "organisationUnits",
      as: "division",
      ui: { formControl: "autocomplete" }
    }
  }, entries);
  assert.equal(JSON.stringify(compact.resource.schema.divisionId), JSON.stringify(explicit.resource.schema.divisionId));
  assert.equal(builtJson(compact.operations), builtJson(explicit.operations));
});

test("a lookup kept as data is not expanded", () => {
  const contract = defineNotes({ title: { type: "string", required: true, lookup: { namespace: "kept-as-data" } } },
    { title: { output: "required", create: "required", patch: "optional" } });
  assert.deepEqual(contract.resource.schema.title.lookup, { namespace: "kept-as-data" });
  assert.equal(Object.hasOwn(contract.resource.schema.title, "belongsTo"), false);
});
