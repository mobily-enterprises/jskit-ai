import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
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
    ...overrides
  });
}

test("defineCrudResource derives full CRUD operations by default", async () => {
  const resource = createContactsResource();

  assert.deepEqual(
    Object.keys(resource.operations),
    ["list", "view", "create", "patch", "delete"]
  );
  assert.deepEqual(resource.operations.list.realtime?.events, ["contacts.record.changed"]);

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

test("defineCrudResource supports an explicit standard CRUD operation subset", () => {
  const resource = createContactsResource({
    crudOperations: ["list", "view", "create"]
  });

  assert.deepEqual(
    Object.keys(resource.operations),
    ["list", "view", "create"]
  );
  assert.equal(Object.hasOwn(resource, "crudOperations"), false);
});

test("defineCrudResource merges authored operation overrides into derived defaults", () => {
  const resource = createContactsResource({
    operations: {
      list: {
        realtime: {
          events: ["contacts.custom.changed"]
        }
      },
      archive: {
        method: "POST",
        output: Object.freeze({
          mode: "replace",
          schema: createSchema({
            archived: {
              type: "boolean",
              required: true
            }
          })
        })
      }
    }
  });

  assert.deepEqual(resource.operations.list.realtime?.events, ["contacts.custom.changed"]);
  assert.equal(resource.operations.archive.method, "POST");
});
