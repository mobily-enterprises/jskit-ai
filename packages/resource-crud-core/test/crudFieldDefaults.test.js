import assert from "node:assert/strict";
import test from "node:test";
import { defineCrudResource } from "../src/shared/crudResource.js";

// A built resource as JSON: each schema as its field definitions, each function as its source.
function builtJson(resource) {
  return JSON.stringify(resource, (key, value) => {
    if (value && typeof value.getFieldDefinitions === "function") {
      return { fields: value.getFieldDefinitions(), mode: value.mode };
    }
    return typeof value === "function" ? String(value) : value;
  });
}

function defineNotes(schema, extra = {}) {
  return defineCrudResource({ namespace: "notes", tableName: "notes", schema, ...extra });
}

const DEFAULT_SHAPED_FIELDS = Object.freeze({
  title: {
    type: "string",
    required: true,
    maxLength: 190,
    operations: {
      output: { required: true },
      create: { required: true },
      patch: { required: false }
    }
  },
  body: {
    type: "string",
    nullable: true,
    operations: {
      output: { required: true },
      create: { required: false },
      patch: { required: false }
    }
  },
  ownerId: {
    type: "id",
    required: true,
    hidden: true,
    operations: {}
  },
  createdAt: {
    type: "dateTime",
    readOnly: true,
    operations: {
      output: { required: true }
    }
  }
});

function withoutOperations(fields, keys) {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    if (!keys.includes(key)) {
      return [key, field];
    }
    const { operations: _operations, ...rest } = field;
    return [key, rest];
  }));
}

test("a field without operations builds the same resource as its default-shaped block", () => {
  const explicit = builtJson(defineNotes(DEFAULT_SHAPED_FIELDS));
  for (const key of Object.keys(DEFAULT_SHAPED_FIELDS)) {
    const resource = defineNotes(withoutOperations(DEFAULT_SHAPED_FIELDS, [key]));
    assert.equal(
      builtJson({ ...resource, schema: null }),
      builtJson({ ...JSON.parse(explicit), schema: null }),
      `${key} without operations`
    );
  }
  const allDefaults = defineNotes(withoutOperations(DEFAULT_SHAPED_FIELDS, Object.keys(DEFAULT_SHAPED_FIELDS)));
  assert.equal(builtJson(allDefaults.operations), JSON.stringify(JSON.parse(explicit).operations));
});

test("a default field is required on create only when the field is required", () => {
  const resource = defineNotes({
    title: { type: "string", required: true },
    body: { type: "string", nullable: true }
  });
  const create = resource.operations.create.body.schema.getFieldDefinitions();
  const patch = resource.operations.patch.body.schema.getFieldDefinitions();
  const output = resource.operations.view.output.schema.getFieldDefinitions();
  assert.equal(create.title.required, true);
  assert.equal(create.body.required, false);
  assert.equal(patch.title.required, false);
  assert.equal(output.body.required, true);
});

test("hidden fields take no operation and read-only fields take output only", () => {
  const resource = defineNotes({
    title: { type: "string", required: true },
    ownerId: { type: "id", required: true, hidden: true },
    createdAt: { type: "dateTime", readOnly: true }
  });
  const fieldsOf = (operation) => Object.keys(operation.schema.getFieldDefinitions());
  assert.deepEqual(fieldsOf(resource.operations.view.output), ["id", "title", "createdAt"]);
  assert.deepEqual(fieldsOf(resource.operations.create.body), ["title"]);
  assert.deepEqual(fieldsOf(resource.operations.patch.body), ["title"]);
});

test("an explicit operations block wins over the default", () => {
  const resource = defineNotes({
    title: { type: "string", required: true },
    placementId: { type: "id", nullable: true, operations: { output: {}, create: {}, patch: {} } },
    ownerId: { type: "id", required: true, hidden: true, operations: { output: { required: true } } }
  });
  const output = resource.operations.view.output.schema.getFieldDefinitions();
  const create = resource.operations.create.body.schema.getFieldDefinitions();
  assert.equal(output.placementId.required, undefined);
  assert.equal(create.placementId.required, undefined);
  assert.equal(output.ownerId.required, true);
  assert.equal(Object.hasOwn(create, "ownerId"), false);
});

const EXPANDED_LOOKUP = Object.freeze({
  type: "id",
  nullable: true,
  search: true,
  relation: { kind: "lookup", namespace: "organisation-units", valueKey: "id" },
  belongsTo: "organisationUnits",
  as: "division",
  ui: { formControl: "autocomplete" },
  operations: {
    output: { required: true },
    create: { required: false },
    patch: { required: false }
  }
});

test("lookup expands to the lookup relation, belongsTo, as and an autocomplete control", () => {
  const compact = defineNotes({
    title: { type: "string", required: true },
    divisionId: { type: "id", nullable: true, search: true, lookup: "organisation-units" }
  });
  const explicit = defineNotes({
    title: { type: "string", required: true },
    divisionId: EXPANDED_LOOKUP
  });
  const { operations: _operations, ...expandedField } = EXPANDED_LOOKUP;
  assert.equal(JSON.stringify(compact.schema.divisionId), JSON.stringify(expandedField));
  assert.equal(builtJson(compact.operations), builtJson(explicit.operations));
});

test("keys written beside lookup win, and relation and ui merge over the filled-in ones", () => {
  const resource = defineNotes({
    title: { type: "string", required: true },
    managerUserId: {
      type: "id",
      lookup: "users",
      belongsTo: "userProfiles",
      relation: { labelKey: "name" },
      ui: { label: "Manager" }
    },
    parent: { type: "id", lookup: "/notes", as: "parentNote", ui: { formControl: "select" } }
  });
  assert.deepEqual(resource.schema.managerUserId, {
    type: "id",
    belongsTo: "userProfiles",
    relation: { kind: "lookup", namespace: "users", valueKey: "id", labelKey: "name" },
    ui: { formControl: "autocomplete", label: "Manager" },
    as: "managerUser"
  });
  assert.deepEqual(resource.schema.parent, {
    type: "id",
    relation: { kind: "lookup", namespace: "notes", valueKey: "id" },
    belongsTo: "notes",
    as: "parentNote",
    ui: { formControl: "select" }
  });
});

test("a lookup needs a namespace, and as when its key has no Id suffix", () => {
  assert.throws(
    () => defineNotes({ title: { type: "string" }, ownerId: { type: "id", lookup: " " } }),
    /schema\.ownerId\.lookup must name the namespace it looks up/
  );
  assert.throws(
    () => defineNotes({ title: { type: "string" }, owner: { type: "id", lookup: "users" } }),
    /schema\.owner has no "Id" suffix, so its lookup must name its relationship with as/
  );
});

test("a resource without the lookup shorthand keeps its own schema object", () => {
  const schema = { title: { type: "string", required: true, lookup: { namespace: "kept-as-data" } } };
  assert.equal(defineNotes(schema).schema, schema);
});

test("lockVersionField must name an integer schema field", () => {
  const schema = {
    title: { type: "string", required: true },
    lockVersion: { type: "integer", min: 0 }
  };
  assert.equal(defineNotes(schema, { lockVersionField: "lockVersion" }).lockVersionField, "lockVersion");
  assert.throws(() => defineNotes(schema, { lockVersionField: "version" }), /lockVersionField must name an integer schema field/);
  assert.throws(() => defineNotes(schema, { lockVersionField: "title" }), /lockVersionField must name an integer schema field/);
});
