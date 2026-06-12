import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared/validators/jsonApiResult";
import { createCrudListFilterContract } from "../src/server/listFilters.js";
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
    contract: Object.freeze({
      lookup: Object.freeze({
        containerKey: "lookups"
      })
    }),
    operations: Object.freeze({
      view: Object.freeze({
        output: createSchemaDefinition({
          id: {
            type: "string",
            required: true
          },
          ownerUserId: {
            type: "string",
            required: false,
            nullable: true,
            belongsTo: "userProfiles",
            as: "owner"
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
          },
          lookups: {
            type: "object",
            required: false
          }
        }, "replace")
      }),
      create: Object.freeze({
        body: createSchemaDefinition({
          ownerUserId: {
            type: "string",
            required: false,
            nullable: true,
            belongsTo: "userProfiles",
            as: "owner"
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
        }, "create"),
        output: createSchemaDefinition({
          id: {
            type: "string",
            required: true
          },
          ownerUserId: {
            type: "string",
            required: false,
            nullable: true,
            belongsTo: "userProfiles",
            as: "owner"
          },
          name: {
            type: "string",
            required: true
          },
          lookups: {
            type: "object",
            required: false
          }
        }, "replace")
      }),
      patch: Object.freeze({
        body: createSchemaDefinition({
          ownerUserId: {
            type: "string",
            required: false,
            nullable: true,
            belongsTo: "userProfiles",
            as: "owner"
          },
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
          ownerUserId: {
            type: "string",
            required: false,
            nullable: true,
            belongsTo: "userProfiles",
            as: "owner"
          },
          name: {
            type: "string",
            required: true
          },
          lookups: {
            type: "object",
            required: false
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
  assert.ok(Object.hasOwn(contracts.viewRouteContract.responses[200].transportSchema.properties, "included"));
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

  const decodedCreateBody = contracts.createRouteContract.transport.request.body({
    data: {
      type: "contacts",
      attributes: {
        name: "Alice"
      },
      relationships: {
        owner: {
          data: {
            type: "userProfiles",
            id: "user-7"
          }
        }
      }
    }
  });

  assert.deepEqual(decodedCreateBody, {
    name: "Alice",
    ownerUserId: "user-7"
  });

  const responseDocument = contracts.viewRouteContract.transport.response(returnJsonApiData({
    id: "contact-1",
    ownerUserId: "user-7",
    name: "Alice",
    lookups: {
      owner: {
        "user-7": {
          id: "user-7",
          name: "User Seven"
        }
      }
    }
  }));

  assert.deepEqual(responseDocument.data.attributes, {
    name: "Alice"
  });
  assert.deepEqual(responseDocument.data.relationships, {
    owner: {
      data: {
        type: "userProfiles",
        id: "user-7"
      }
    }
  });
  assert.deepEqual(responseDocument.included, [
    {
      type: "userProfiles",
      id: "user-7",
      attributes: {
        name: "User Seven"
      }
    }
  ]);

  const lookupOnlyRelationshipDocument = contracts.viewRouteContract.transport.response(returnJsonApiData({
    id: "contact-3",
    name: "Charlie",
    lookups: {
      owner: {
        id: "user-8",
        name: "User Eight"
      }
    }
  }));

  assert.deepEqual(lookupOnlyRelationshipDocument.data.relationships, {
    owner: {
      data: {
        type: "userProfiles",
        id: "user-8"
      }
    }
  });

  const listResponseDocument = contracts.listRouteContract.transport.response(returnJsonApiData({
    items: [
      {
        id: "contact-1",
        ownerUserId: "user-7",
        name: "Alice",
        lookups: {
          owner: {
            "user-7": {
              id: "user-7",
              name: "User Seven"
            }
          }
        }
      },
      {
        id: "contact-2",
        ownerUserId: "user-7",
        name: "Bob",
        lookups: {
          ownerUserId: {
            id: "user-7",
            name: "User Seven"
          }
        }
      }
    ]
  }));

  assert.deepEqual(listResponseDocument.included, [
    {
      type: "userProfiles",
      id: "user-7",
      attributes: {
        name: "User Seven"
      }
    }
  ]);
});

test("createCrudJsonApiRouteContracts includes configured list filter validators", async () => {
  const listFilterContract = createCrudListFilterContract({
    status: {
      type: "enumMany",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" }
      ]
    }
  });

  const contracts = createCrudJsonApiRouteContracts({
    resource: createCrudResource(),
    listFilterQueryValidator: listFilterContract.queryValidator
  });

  assert.deepEqual(await validateSchemaPayload(contracts.listRouteContract.query, {
    status: ["active", "archived"]
  }, { phase: "input" }), {
    status: ["active", "archived"]
  });
});

test("createCrudJsonApiRouteContracts reads list filter validators from the resource contract", async () => {
  const listFilterContract = createCrudListFilterContract({
    status: {
      type: "enum",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" }
      ]
    }
  });
  const resource = {
    ...createCrudResource(),
    contract: {
      listFilters: listFilterContract
    }
  };

  const contracts = createCrudJsonApiRouteContracts({ resource });

  assert.deepEqual(await validateSchemaPayload(contracts.listRouteContract.query, {
    status: "archived"
  }, { phase: "input" }), {
    status: "archived"
  });
});

test("createCrudJsonApiRouteContracts serializes collection relationships from hydrated lookups", () => {
  const output = createSchemaDefinition({
    id: {
      type: "string",
      required: true
    },
    name: {
      type: "string",
      required: true
    },
    pets: {
      type: "array",
      required: false,
      relation: {
        kind: "collection",
        namespace: "pets",
        foreignKey: "contactId"
      }
    },
    lookups: {
      type: "object",
      required: false
    }
  }, "replace");
  const body = createSchemaDefinition({
    name: {
      type: "string",
      required: true
    }
  }, "create");
  const contracts = createCrudJsonApiRouteContracts({
    resource: {
      namespace: "contacts",
      contract: {
        lookup: {
          containerKey: "lookups"
        }
      },
      operations: {
        view: { output },
        create: { body, output },
        patch: { body, output }
      }
    }
  });

  const responseDocument = contracts.viewRouteContract.transport.response(returnJsonApiData({
    id: "contact-1",
    name: "Alice",
    lookups: {
      pets: [
        {
          id: "pet-1",
          name: "Ada",
          contactId: "contact-1"
        },
        {
          id: "pet-2",
          name: "Bert",
          contactId: "contact-1"
        }
      ]
    }
  }));
  const resourceSchema = contracts.viewRouteContract.responses[200].transportSchema.definitions.contactsSuccessResource;
  const relationshipDataSchema = resourceSchema.properties.relationships.properties.pets.properties.data;

  assert.deepEqual(responseDocument.data.attributes, {
    name: "Alice"
  });
  assert.deepEqual(responseDocument.data.relationships, {
    pets: {
      data: [
        {
          type: "pets",
          id: "pet-1"
        },
        {
          type: "pets",
          id: "pet-2"
        }
      ]
    }
  });
  assert.deepEqual(responseDocument.included, [
    {
      type: "pets",
      id: "pet-1",
      attributes: {
        name: "Ada",
        contactId: "contact-1"
      }
    },
    {
      type: "pets",
      id: "pet-2",
      attributes: {
        name: "Bert",
        contactId: "contact-1"
      }
    }
  ]);
  assert.equal(relationshipDataSchema.anyOf[0].type, "array");
  assert.equal(relationshipDataSchema.anyOf[0].items.properties.type.const, "pets");
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
