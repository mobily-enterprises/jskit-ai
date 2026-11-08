import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNERSHIP_KINDS,
  defineTableResource,
  isTableResource,
  resourceNameFromNamespace
} from "../src/shared/tableResource.js";

function receivals(overrides = {}) {
  return {
    name: "receivals",
    tableName: "receivals",
    ownership: "workspace",
    lockVersionField: "lockVersion",
    schema: {
      workspaceId: { type: "id", required: true, hidden: true },
      status: { type: "string", required: true, search: true },
      lockVersion: { type: "integer", defaultTo: 1 }
    },
    ...overrides
  };
}

test("a table resource holds the table's facts, frozen, and is recognised as one", () => {
  const resource = defineTableResource(receivals({ searchSchema: { status: { type: "string" } }, defaultSort: ["-id"] }));

  assert.equal(resource.name, "receivals");
  assert.equal(resource.tableName, "receivals");
  assert.equal(resource.ownership, "workspace");
  assert.deepEqual(resource.defaultSort, ["-id"]);
  assert.equal(Object.isFrozen(resource), true);
  assert.equal(Object.isFrozen(resource.schema.status), true);
  assert.equal(isTableResource(resource), true);
  assert.equal(isTableResource({ ...resource }), false);
  assert.equal(isTableResource(null), false);
});

test("ownership is required and must be one of the ownership kinds", () => {
  assert.deepEqual(OWNERSHIP_KINDS, ["public", "workspace", "user", "workspace_user", "workspace_or_shared", "system"]);
  for (const ownership of OWNERSHIP_KINDS) {
    assert.equal(defineTableResource(receivals({ ownership })).ownership, ownership);
  }
  for (const ownership of [undefined, "", "tenant"]) {
    assert.throws(
      () => defineTableResource(receivals({ ownership })),
      /requires ownership, one of: public, workspace, user, workspace_user, workspace_or_shared, system/u
    );
  }
});

test("a table resource needs a name, a table and fields", () => {
  assert.throws(() => defineTableResource(receivals({ name: "" })), /requires name/u);
  assert.throws(() => defineTableResource(receivals({ name: "processing-lots" })), /name must start with a letter/u);
  assert.throws(() => defineTableResource(receivals({ tableName: " " })), /requires tableName/u);
  assert.throws(() => defineTableResource(receivals({ schema: {} })), /requires schema/u);
  assert.throws(() => defineTableResource(receivals({ schema: { status: "string" } })), /schema\.status must be an object/u);
  assert.throws(() => defineTableResource(), /requires a definition object/u);
});

test("the HTTP surface, field operations and server-only extras are refused with where they belong", () => {
  assert.throws(() => defineTableResource(receivals({ namespace: "receivals" })), /does not take namespace: it belongs to the CRUD or API contract/u);
  assert.throws(() => defineTableResource(receivals({ apiAccess: "public" })), /does not take apiAccess: it belongs to the CRUD contract/u);
  assert.throws(() => defineTableResource(receivals({ autofilter: "workspace" })), /does not take autofilter: it belongs to ownership/u);
  assert.throws(() => defineTableResource(receivals({ rowPolicy: () => true })), /does not take rowPolicy: it belongs to the owner feature's owns entry/u);
  assert.throws(
    () => defineTableResource(receivals({ schema: { status: { type: "string", operations: { output: { required: true } } } } })),
    /schema\.status\.operations belongs to the CRUD contract: defineCrudContract\(resource, \{ namespace, fields: \{ status: \.\.\. \} \}\)/u
  );
});

test("a field's default value is defaultTo: default, which json-rest-api would ignore, is refused", () => {
  assert.throws(
    () => defineTableResource(receivals({ lockVersionField: undefined, schema: { status: { type: "string", default: "open" } } })),
    /schema\.status\.default would be ignored: a field's default value is defaultTo/u
  );
  assert.equal(defineTableResource(receivals({ lockVersionField: undefined, schema: { status: { type: "string", defaultTo: "open" } } })).schema.status.defaultTo, "open");
});

test("a field with defaultTo is not required: a create is checked for required fields before defaults apply", () => {
  assert.throws(
    () => defineTableResource(receivals({ lockVersionField: undefined, schema: { status: { type: "string", required: true, defaultTo: "open" } } })),
    /schema\.status is required and has defaultTo: a field with defaultTo is not required/u
  );
  assert.equal(defineTableResource(receivals({
    lockVersionField: undefined,
    schema: { status: { type: "string", required: false, defaultTo: "open" }, title: { type: "string", required: true } }
  })).schema.status.defaultTo, "open");
});

test("lockVersionField names an integer field", () => {
  assert.throws(() => defineTableResource(receivals({ lockVersionField: "status" })), /lockVersionField must name an integer schema field/u);
  assert.throws(() => defineTableResource(receivals({ lockVersionField: "missing" })), /lockVersionField must name an integer schema field/u);
});

test("a lookup field names the namespace it looks up and belongs to that namespace's resource", () => {
  const resource = defineTableResource(receivals({
    lockVersionField: undefined,
    schema: {
      lotId: { type: "id", nullable: true, lookup: "processing-lots" },
      supplierId: { type: "id", lookup: "suppliers", ui: { formControl: "select" }, relation: { labelKey: "name" } },
      owner: { type: "id", lookup: "users", as: "ownerUser", belongsTo: "userProfiles" }
    }
  }));

  assert.deepEqual(resource.schema.lotId, {
    type: "id",
    nullable: true,
    relation: { kind: "lookup", namespace: "processing-lots", valueKey: "id" },
    belongsTo: "processingLots",
    as: "lot",
    ui: { formControl: "autocomplete" }
  });
  assert.deepEqual(resource.schema.supplierId.ui, { formControl: "select" });
  assert.deepEqual(resource.schema.supplierId.relation, { kind: "lookup", namespace: "suppliers", valueKey: "id", labelKey: "name" });
  assert.equal(resource.schema.owner.belongsTo, "userProfiles");
  assert.equal(resource.schema.owner.as, "ownerUser");
  const lookupOnly = (schema) => receivals({ lockVersionField: undefined, schema });
  assert.throws(() => defineTableResource(lookupOnly({ owner: { type: "id", lookup: "users" } })), /schema\.owner has no "Id" suffix/u);
  assert.throws(() => defineTableResource(lookupOnly({ lotId: { type: "id", lookup: "/" } })), /lotId\.lookup must name the namespace/u);
});

test("a namespace's resource name is its camel case", () => {
  assert.equal(resourceNameFromNamespace("processing-lots"), "processingLots");
  assert.equal(resourceNameFromNamespace("/admin/processing_lots/"), "adminProcessingLots");
  assert.equal(resourceNameFromNamespace("users"), "users");
  assert.equal(resourceNameFromNamespace(""), "");
});

test("foreignKeys declares the table's database keys on its schema fields, in json-rest-api's shape", () => {
  const keys = [
    { columns: ["workspaceId"], referencedTableName: "workspaces", deleteRule: "CASCADE" },
    { name: "fk_receivals_status", columns: ["workspaceId", "status"], referencedTableName: "statuses", referencedColumns: ["workspace_id", "code"] }
  ];
  const resource = defineTableResource(receivals({ foreignKeys: keys }));
  assert.deepEqual(resource.foreignKeys, keys);
  assert.equal(Object.isFrozen(resource.foreignKeys[0]), true);
  assert.equal(Object.hasOwn(defineTableResource(receivals()), "foreignKeys"), false);

  const declaring = (foreignKeys) => () => defineTableResource(receivals({ foreignKeys }));
  assert.throws(declaring([]), /foreignKeys must be a non-empty list; leave it out/u);
  assert.throws(declaring([{ columns: ["lotId"], referencedTableName: "lots" }]), /foreignKeys\[0\]\.columns names "lotId", which is not a schema field/u);
  assert.throws(declaring([{ columns: [], referencedTableName: "lots" }]), /foreignKeys\[0\]\.columns must be a non-empty list of names/u);
  assert.throws(declaring([{ columns: ["status"] }]), /requires foreignKeys\[0\]\.referencedTableName/u);
  assert.throws(declaring([{ columns: ["status"], table: "statuses" }]), /foreignKeys\[0\] does not take table\. Its keys are name, columns/u);
  assert.throws(
    declaring([{ columns: ["workspaceId", "status"], referencedTableName: "statuses" }]),
    /foreignKeys\[0\]\.referencedColumns must name one referenced column for each of its columns/u
  );
  assert.throws(
    declaring([{ columns: ["status"], referencedTableName: "statuses", referencedColumns: ["code", "kind"] }]),
    /referencedColumns must name one referenced column for each/u
  );
  assert.throws(declaring([{ columns: ["status"], referencedTableName: "statuses", deleteRule: 1 }]), /foreignKeys\[0\]\.deleteRule must be text/u);
});
