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
  assert.deepEqual(OWNERSHIP_KINDS, ["public", "workspace", "user", "workspace_user", "workspace_or_shared"]);
  for (const ownership of OWNERSHIP_KINDS) {
    assert.equal(defineTableResource(receivals({ ownership })).ownership, ownership);
  }
  for (const ownership of [undefined, "", "tenant"]) {
    assert.throws(
      () => defineTableResource(receivals({ ownership })),
      /requires ownership, one of: public, workspace, user, workspace_user, workspace_or_shared/u
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
    /schema\.status\.operations belongs to the CRUD contract: defineCrudContract\(resource, \{ fields: \{ status: \.\.\. \} \}\)/u
  );
});

test("a field's default value is defaultTo: default, which json-rest-api would ignore, is refused", () => {
  assert.throws(
    () => defineTableResource(receivals({ lockVersionField: undefined, schema: { status: { type: "string", default: "open" } } })),
    /schema\.status\.default would be ignored: a field's default value is defaultTo/u
  );
  assert.equal(defineTableResource(receivals({ lockVersionField: undefined, schema: { status: { type: "string", defaultTo: "open" } } })).schema.status.defaultTo, "open");
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
