import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
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
  ownerId: { type: "id", required: true, hidden: true },
  createdAt: { type: "dateTime", readOnly: true }
});

// The entry each field would take by default, written out.
const DEFAULT_SHAPED_ENTRIES = Object.freeze({
  title: { output: { required: true }, create: { required: true }, patch: { required: false } },
  body: { output: { required: true }, create: { required: false }, patch: { required: false } },
  ownerId: {},
  createdAt: { output: { required: true } }
});

test("a field without an entry in fields builds the same contract as its default-shaped entry", () => {
  const explicit = builtJson(defineNotes(NOTE_FIELDS, DEFAULT_SHAPED_ENTRIES).operations);
  for (const key of Object.keys(DEFAULT_SHAPED_ENTRIES)) {
    const { [key]: _omitted, ...entries } = DEFAULT_SHAPED_ENTRIES;
    assert.equal(builtJson(defineNotes(NOTE_FIELDS, entries).operations), explicit, `${key} without an entry`);
  }
  assert.equal(builtJson(defineNotes(NOTE_FIELDS).operations), explicit);
});

test("a default field is required on create only when the field is required", () => {
  const contract = defineNotes({
    title: { type: "string", required: true },
    body: { type: "string", nullable: true }
  });
  const create = contract.operations.create.body.schema.getFieldDefinitions();
  const patch = contract.operations.patch.body.schema.getFieldDefinitions();
  const output = contract.operations.view.output.schema.getFieldDefinitions();
  assert.equal(create.title.required, true);
  assert.equal(create.body.required, false);
  assert.equal(patch.title.required, false);
  assert.equal(output.body.required, true);
});

test("primary-key and hidden fields take no operation and read-only fields take output only", () => {
  const contract = defineNotes({
    id: { type: "id", primary: true },
    title: { type: "string", required: true },
    ownerId: { type: "id", required: true, hidden: true },
    createdAt: { type: "dateTime", readOnly: true }
  });
  const fieldsOf = (operation) => Object.keys(operation.schema.getFieldDefinitions());
  assert.deepEqual(fieldsOf(contract.operations.view.output), ["id", "title", "createdAt"]);
  assert.equal(contract.operations.view.output.schema.getFieldDefinitions().id.type, "string");
  assert.deepEqual(fieldsOf(contract.operations.create.body), ["title"]);
  assert.deepEqual(fieldsOf(contract.operations.patch.body), ["title"]);
});

test("a field's entry wins over the default", () => {
  const contract = defineNotes({
    title: { type: "string", required: true },
    placementId: { type: "id", nullable: true },
    ownerId: { type: "id", required: true, hidden: true }
  }, {
    placementId: { output: {}, create: {}, patch: {} },
    ownerId: { output: { required: true } }
  });
  const output = contract.operations.view.output.schema.getFieldDefinitions();
  const create = contract.operations.create.body.schema.getFieldDefinitions();
  assert.equal(output.placementId.required, undefined);
  assert.equal(create.placementId.required, undefined);
  assert.equal(output.ownerId.required, true);
  assert.equal(Object.hasOwn(create, "ownerId"), false);
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
  const compact = defineNotes({
    title: { type: "string", required: true },
    divisionId: { type: "id", nullable: true, search: true, lookup: "organisation-units" }
  });
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
  });
  assert.equal(JSON.stringify(compact.resource.schema.divisionId), JSON.stringify(explicit.resource.schema.divisionId));
  assert.equal(builtJson(compact.operations), builtJson(explicit.operations));
});

test("a lookup kept as data is not expanded", () => {
  const contract = defineNotes({ title: { type: "string", required: true, lookup: { namespace: "kept-as-data" } } });
  assert.deepEqual(contract.resource.schema.title.lookup, { namespace: "kept-as-data" });
  assert.equal(Object.hasOwn(contract.resource.schema.title, "belongsTo"), false);
});
