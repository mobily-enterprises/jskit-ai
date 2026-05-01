import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { createCrudJsonApiRouteContracts } from "../src/server/routeContracts.js";

function createSchemaDefinition(structure = {}, mode = "patch") {
  return Object.freeze({
    schema: createSchema(structure),
    mode
  });
}

function createCrudResource() {
  return Object.freeze({
    namespace: "contacts",
    defaultSort: Object.freeze(["-createdAt"]),
    operations: Object.freeze({
      view: Object.freeze({
        output: createSchemaDefinition({
          id: {
            type: "string",
            required: true
          },
          contactId: {
            type: "string",
            required: false,
            relation: {
              kind: "lookup",
              apiPath: "/contacts",
              valueKey: "id"
            }
          },
          name: {
            type: "string",
            required: true
          }
        }, "replace")
      }),
      create: Object.freeze({
        body: createSchemaDefinition({
          contactId: {
            type: "string",
            required: false,
            relation: {
              kind: "lookup",
              apiPath: "/contacts",
              valueKey: "id"
            }
          },
          name: {
            type: "string",
            required: true
          }
        }, "create"),
        output: createSchemaDefinition({
          id: {
            type: "string",
            required: true
          },
          name: {
            type: "string",
            required: true
          }
        }, "replace")
      }),
      patch: Object.freeze({
        body: createSchemaDefinition({
          name: {
            type: "string",
            required: false
          }
        }, "patch"),
        output: createSchemaDefinition({
          id: {
            type: "string",
            required: true
          },
          name: {
            type: "string",
            required: true
          }
        }, "replace")
      })
    })
  });
}

test("createCrudJsonApiRouteContracts builds default CRUD JSON:API contracts", async () => {
  const resource = createCrudResource();
  const routeParamsValidator = createSchemaDefinition({
    workspaceSlug: {
      type: "string",
      required: true
    }
  });

  const contracts = createCrudJsonApiRouteContracts({
    resource,
    routeParamsValidator
  });

  assert.equal(contracts.listRouteContract.transport.contentType, "application/vnd.api+json");
  assert.equal(contracts.viewRouteContract.transport.contentType, "application/vnd.api+json");
  assert.equal(contracts.createRouteContract.transport.contentType, "application/vnd.api+json");
  assert.equal(contracts.updateRouteContract.transport.contentType, "application/vnd.api+json");
  assert.equal(contracts.listRouteContract.responses[200].transportSchema.type, "object");
  assert.equal(contracts.createRouteContract.responses[201].transportSchema.type, "object");
  assert.equal(contracts.updateRouteContract.responses[200].transportSchema.type, "object");
  assert.equal(Object.hasOwn(contracts.deleteRouteContract.responses, "204"), false);
  assert.equal(contracts.createRouteContract.body, resource.operations.create.body);
  assert.equal(contracts.updateRouteContract.body, resource.operations.patch.body);
  assert.deepEqual(
    Object.keys(contracts.recordRouteParamsValidator.schema.getFieldDefinitions()).sort(),
    ["recordId", "workspaceSlug"]
  );

  const normalizedListQuery = await validateSchemaPayload(contracts.listRouteContract.query, {
    q: "  hello  ",
    include: "  ownerId  ",
    contactId: "  42  ",
    cursor: "  offset:2  ",
    limit: "25"
  }, { phase: "input" });

  assert.deepEqual(normalizedListQuery, {
    q: "hello",
    include: "ownerId",
    contactId: "42",
    cursor: "offset:2",
    limit: 25
  });
});

test("createCrudJsonApiRouteContracts falls back to recordId params when no route params validator is provided", () => {
  const contracts = createCrudJsonApiRouteContracts({
    resource: createCrudResource()
  });

  assert.deepEqual(
    Object.keys(contracts.recordRouteParamsValidator.schema.getFieldDefinitions()),
    ["recordId"]
  );
});
