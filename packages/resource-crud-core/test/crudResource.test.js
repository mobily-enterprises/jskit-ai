import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { createSchemaDefinition } from "@jskit-ai/resource-core/shared/resource";
import { defineCrudResource } from "../src/shared/crudResource.js";

function createContactsResource(overrides = {}) {
  return defineCrudResource({
    namespace: "contacts",
    schema: {
      name: {
        type: "string",
        maxLength: 190,
        operations: {
          output: { required: true },
          create: { required: true },
          patch: { required: false }
        }
      },
      createdAt: {
        type: "dateTime",
        operations: {
          output: { required: true }
        }
      }
    },
    contract: {
      lookup: {
        containerKey: "lookups"
      }
    },
    messages: {
      validation: "Fix invalid values."
    },
    ...overrides
  });
}

test("defineCrudResource derives standard CRUD operations and resource messages", async () => {
  const resource = createContactsResource();

  assert.deepEqual(
    Object.keys(resource.operations),
    ["list", "view", "create", "patch", "delete"]
  );
  assert.deepEqual(resource.operations.list.realtime?.events, ["contacts.record.changed"]);
  assert.equal(resource.operations.view.messages, resource.messages);

  const normalizedCreateBody = await validateSchemaPayload(resource.operations.create.body, {
    name: "  Example  "
  }, { phase: "input" });
  assert.equal(normalizedCreateBody.name, "Example");

  const normalizedViewOutput = await validateSchemaPayload(resource.operations.view.output, {
    id: 7,
    name: " Example ",
    createdAt: "2026-05-01 12:30:00.000",
    lookups: {}
  }, { phase: "output" });
  assert.equal(normalizedViewOutput.id, "7");
  assert.equal(normalizedViewOutput.name, "Example");
  assert.ok(normalizedViewOutput.createdAt instanceof Date);
});

test("defineCrudResource preserves authored namespace and supports replace bodies", async () => {
  const resource = createContactsResource({
    namespace: "userProfile",
    crudOperations: ["view", "create", "replace", "patch"],
    crud: {
      output: createSchema({
        id: {
          type: "string",
          required: true,
          minLength: 1
        },
        name: {
          type: "string",
          required: true,
          minLength: 1
        }
      }),
      body: createSchema({
        name: {
          type: "string",
          required: true,
          minLength: 1
        }
      })
    }
  });

  assert.equal(resource.namespace, "userProfile");
  assert.deepEqual(Object.keys(resource.operations), ["view", "create", "replace", "patch"]);
  assert.equal(resource.operations.replace.body.mode, "replace");

  const normalizedReplaceBody = await validateSchemaPayload(resource.operations.replace.body, {
    name: " Example "
  }, { phase: "input" });
  assert.equal(normalizedReplaceBody.name, "Example");
});

test("defineCrudResource supports explicit list item output and custom operation overrides", () => {
  const resource = createContactsResource({
    crudOperations: ["list", "view", "create", "patch"],
    crud: {
      output: createSchema({
        id: {
          type: "string",
          required: true
        }
      }),
      listItemOutput: createSchema({
        id: {
          type: "string",
          required: true
        },
        label: {
          type: "string",
          required: true
        }
      })
    },
    operations: {
      list: {
        realtime: {
          events: ["contacts.custom.changed"]
        }
      },
      archive: {
        method: "POST",
        output: createSchemaDefinition(createSchema({
          archived: {
            type: "boolean",
            required: true
          }
        }), "replace")
      }
    }
  });

  assert.deepEqual(resource.operations.list.realtime?.events, ["contacts.custom.changed"]);
  assert.equal(resource.operations.archive.method, "POST");
  assert.equal(resource.operations.list.output.schema.toJsonSchema({ mode: "replace" }).properties.items.type, "array");
});
