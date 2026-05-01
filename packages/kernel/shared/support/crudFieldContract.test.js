import assert from "node:assert/strict";
import test from "node:test";

import { buildCrudOperationSchemaFields } from "./crudFieldContract.js";

test("buildCrudOperationSchemaFields projects operation-aware field definitions without losing metadata", () => {
  const serializer = () => "serialized";
  const fields = Object.freeze({
    name: Object.freeze({
      type: "string",
      maxLength: 190,
      search: true,
      ui: Object.freeze({
        label: "Name"
      }),
      operations: Object.freeze({
        output: Object.freeze({
          required: true
        }),
        create: Object.freeze({
          required: true
        }),
        patch: Object.freeze({
          required: false
        })
      })
    }),
    createdAt: Object.freeze({
      type: "dateTime",
      storage: Object.freeze({
        column: "created_at",
        writeSerializer: "datetime-utc",
        serialize: serializer
      }),
      operations: Object.freeze({
        output: Object.freeze({
          required: true
        })
      })
    }),
    workspaceId: Object.freeze({
      type: "id",
      required: true,
      operations: Object.freeze({})
    })
  });

  const outputFields = buildCrudOperationSchemaFields(fields, "output");
  const createFields = buildCrudOperationSchemaFields(fields, "create");

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
  assert.equal(fields.name.operations.output.required, true);
  assert.equal(Object.hasOwn(fields.name, "operations"), true);
});
