import assert from "node:assert/strict";
import test from "node:test";

import { buildCrudOperationSchemaFields } from "../src/shared/crudFieldContract.js";

test("buildCrudOperationSchemaFields projects each field the CRUD contract gives an operation, without losing metadata", () => {
  const serializer = () => "serialized";
  const fields = Object.freeze({
    name: Object.freeze({
      type: "string",
      maxLength: 190,
      search: true,
      ui: Object.freeze({
        label: "Name"
      })
    }),
    createdAt: Object.freeze({
      type: "dateTime",
      storage: Object.freeze({
        column: "created_at",
        writeSerializer: "datetime-utc",
        serialize: serializer
      })
    }),
    workspaceId: Object.freeze({
      type: "id",
      required: true
    })
  });
  const fieldOperations = Object.freeze({
    name: Object.freeze({ output: { required: true }, create: { required: true }, patch: { required: false } }),
    createdAt: Object.freeze({ output: { required: true } }),
    workspaceId: Object.freeze({})
  });

  const outputFields = buildCrudOperationSchemaFields(fields, "output", fieldOperations);
  const createFields = buildCrudOperationSchemaFields(fields, "create", fieldOperations);

  assert.deepEqual(Object.keys(outputFields).sort(), ["createdAt", "name"]);
  assert.deepEqual(Object.keys(createFields).sort(), ["name"]);

  assert.equal(outputFields.name.required, true);
  assert.equal(outputFields.name.maxLength, 190);
  assert.equal(outputFields.name.search, true);
  assert.equal(outputFields.name.ui.label, "Name");
  assert.equal(Object.hasOwn(outputFields.name, "operations"), false);

  assert.equal(outputFields.createdAt.storage.column, "created_at");
  assert.equal(outputFields.createdAt.storage.writeSerializer, "datetime-utc");
  assert.equal(outputFields.createdAt.storage.serialize, serializer);

  assert.equal(createFields.name.required, true);
  assert.equal(Object.hasOwn(fields.name, "required"), false);
});
