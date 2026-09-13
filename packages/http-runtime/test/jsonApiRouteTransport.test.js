import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import knexLib from "knex";
import {
  RestApiFieldsetError,
  RestApiIncludeError,
  RestApiPayloadError,
  RestApiPreconditionFailedError,
  RestApiResourceError,
  RestApiTemporalDataError,
  RestApiValidationError,
  RestApiVersionConflictError,
  RestApiWriteError
} from "json-rest-api";

import {
  JSON_API_CONTENT_TYPE,
  apiErrorTransportSchema,
  encodeJsonApiResourceQueryObject,
  createJsonApiResourceQueryTransportSchema,
  createJsonApiResourceRequestBodyTransportSchema,
  createJsonApiResourceRouteContract,
  createJsonApiResourceRouteTransport,
  createJsonApiResourceSuccessTransportSchema,
  returnJsonApiData,
  returnJsonApiDocument,
  returnJsonApiMeta
} from "../src/shared/index.js";
import { createSchema } from "../../kernel/shared/validators/index.js";
import { resolveRouteValidatorOptions } from "../../kernel/server/http/lib/routeValidator.js";
import { registerApiErrorHandler } from "../../kernel/server/runtime/fastifyBootstrap.js";
import { AppError, isAppError } from "../../kernel/server/runtime/errors.js";
import { createHttpError } from "../src/shared/clientRuntime/errors.js";
import { createJsonRestApiHost } from "../../json-rest-api-core/src/server/jsonRestApiHost.js";

const CONTACT_BODY_SCHEMA = Object.freeze({
  schema: createSchema({
    name: {
      type: "string",
      required: true,
      minLength: 1
    },
    subscribed: {
      type: "boolean",
      required: false
    }
  }),
  mode: "create"
});

const CONTACT_RECORD_SCHEMA = Object.freeze({
  schema: createSchema({
    id: {
      type: "string",
      required: true,
      minLength: 1
    },
    name: {
      type: "string",
      required: true,
      minLength: 1
    },
    subscribed: {
      type: "boolean",
      required: true
    }
  }),
  mode: "replace"
});

const CONTACT_LIST_QUERY_SCHEMA = Object.freeze({
  schema: createSchema({
    cursor: {
      type: "string",
      required: false,
      minLength: 1
    },
    limit: {
      type: "number",
      required: false,
      min: 1
    },
    q: {
      type: "string",
      required: false
    },
    include: {
      type: "string",
      required: false
    },
    fields: {
      type: "object",
      required: false,
      values: {
        type: "array",
        items: {
          type: "string",
          minLength: 1
        }
      }
    },
    workspaceId: {
      type: "string",
      required: false,
      minLength: 1
    }
  }),
  mode: "patch"
});

test("createJsonApiResourceRequestBodyTransportSchema wraps plain body schema in a JSON:API document", () => {
  const schema = createJsonApiResourceRequestBodyTransportSchema({
    type: "contacts",
    attributes: CONTACT_BODY_SCHEMA
  });

  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["data"]);
  assert.equal(schema.properties.data.allOf[0].$ref, "#/definitions/contactsRequestResource");

  const resourceSchema = schema.definitions.contactsRequestResource;
  assert.deepEqual(resourceSchema.required, ["type", "attributes"]);
  assert.equal(resourceSchema.properties.type.const, "contacts");
  assert.equal(resourceSchema.properties.attributes.allOf[0].$ref, "#/definitions/contactsRequestResource__contacts_resource_attributes");
});

test("createJsonApiResourceSuccessTransportSchema wraps plain record schema in a JSON:API response document", () => {
  const schema = createJsonApiResourceSuccessTransportSchema({
    type: "contacts",
    attributes: CONTACT_RECORD_SCHEMA,
    kind: "record",
    includeMeta: true
  });

  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["data"]);
  assert.equal(schema.properties.data.allOf[0].$ref, "#/definitions/contactsSuccessResource");
  assert.equal(schema.properties.meta.type, "object");

  const resourceSchema = schema.definitions.contactsSuccessResource;
  assert.deepEqual(resourceSchema.required, ["type", "attributes", "id"]);
  assert.equal(resourceSchema.properties.type.const, "contacts");
});

test("createJsonApiResourceRouteTransport unwraps request payloads and wraps resource/error responses", () => {
  const transport = createJsonApiResourceRouteTransport({
    type: "contacts",
    successKind: "collection"
  });

  const plainBody = transport.request.body({
    data: {
      type: "contacts",
      attributes: {
        name: "Merc",
        subscribed: true
      }
    }
  });
  assert.deepEqual(plainBody, {
    name: "Merc",
    subscribed: true
  });

  const response = transport.response(returnJsonApiData({
    items: [
      { id: "1", name: "Merc", subscribed: true },
      { id: "2", name: "Tony", subscribed: false }
    ],
    nextCursor: "cursor_2"
  }));
  assert.deepEqual(response, {
    data: [
      {
        type: "contacts",
        id: "1",
        attributes: {
          name: "Merc",
          subscribed: true
        }
      },
      {
        type: "contacts",
        id: "2",
        attributes: {
          name: "Tony",
          subscribed: false
        }
      }
    ],
    meta: {
      page: {
        nextCursor: "cursor_2"
      }
    }
  });

  const errorPayload = transport.error({
    message: "Validation failed.",
    validation: [
      {
        instancePath: "/data/attributes/name",
        message: "must NOT have fewer than 1 characters"
      }
    ],
    validationContext: "body"
  }, {
    statusCode: 400,
    code: "validation_failed"
  });

  assert.equal(errorPayload.errors[0].status, "400");
  assert.equal(errorPayload.errors[0].code, "validation_failed");
  assert.equal(errorPayload.errors[0].source.pointer, "/data/attributes/name");
});

test("real HTTP responses classify typed JSON REST read and write errors", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app, { isAppError });
  const transport = createJsonApiResourceRouteTransport({ type: "books" });
  const cases = [
    ["validation", () => new RestApiValidationError("Title is required."), 422],
    ["missing", () => new RestApiResourceError("Book not found.", { subtype: "not_found" }), 404],
    ["forbidden", () => new RestApiResourceError("Book is forbidden.", { subtype: "forbidden" }), 403],
    ["conflict", () => new RestApiResourceError("Book conflicts.", { subtype: "conflict" }), 409],
    ["resource", () => new RestApiResourceError("Invalid resource."), 400],
    ["version", () => new RestApiVersionConflictError({ resourceType: "books", resourceId: "1" }), 409],
    ["precondition", () => new RestApiPreconditionFailedError({ resourceType: "books", resourceId: "1" }), 412],
    ["fieldset", () => new RestApiFieldsetError({ resourceType: "books", field: "missing" }), 400],
    ["include", () => new RestApiIncludeError({ resourceType: "books", path: "missing" }), 400],
    ["payload", () => new RestApiPayloadError("Invalid document."), 400],
    ["large-payload", () => new RestApiPayloadError("Document too large.", { statusCode: 413 }), 413],
    ["temporal", () => new RestApiTemporalDataError({ resourceType: "private_table", field: "private_column", fieldType: "date" }), 500],
    ["custom-status", () => Object.assign(new Error("Custom error."), { status: 418 }), 418],
    ["server-status", () => Object.assign(new Error("private server failure"), { statusCode: 503 }), 503],
    ["invalid-status", () => Object.assign(new Error("private invalid status"), { statusCode: 200 }), 500]
  ];

  for (const jsonapi of [false, true]) {
    for (const wrapped of [false, true]) {
      const prefix = `/${jsonapi ? "jsonapi" : "plain"}/${wrapped ? "write" : "read"}`;
      app.get(`${prefix}/:kind`, {
        config: jsonapi ? { transport: { runtime: transport } } : {},
        ...(jsonapi ? {} : { schema: { response: { "4xx": apiErrorTransportSchema, "5xx": apiErrorTransportSchema } } })
      }, async (request) => {
        const [, createError] = cases.find(([name]) => name === request.params.kind);
        const cause = createError();
        if (wrapped) {
          throw new RestApiWriteError(cause.message, { cause, transactionOutcome: "rolledBack" });
        }
        throw cause;
      });
    }
  }

  for (const jsonapi of [false, true]) {
    for (const wrapped of [false, true]) {
      for (const [name, createError, expectedStatus] of cases) {
        const url = `/${jsonapi ? "jsonapi" : "plain"}/${wrapped ? "write" : "read"}/${name}`;
        const response = await app.inject({ method: "GET", url });
        assert.equal(response.statusCode, expectedStatus, url);
        const payload = response.json();
        const clientError = createHttpError({ status: response.statusCode }, payload);
        assert.equal(clientError.status, expectedStatus, url);
        assert.equal(clientError.transactionOutcome, wrapped ? "rolledBack" : undefined, url);
        assert.equal(clientError.message, expectedStatus >= 500 ? "Internal server error." : createError().message, url);
        assert.equal(clientError.cause, undefined);
        if (jsonapi) {
          assert.equal(payload.errors[0].status, String(expectedStatus));
          assert.match(response.headers["content-type"], /^application\/vnd\.api\+json/u);
        }
        if (expectedStatus >= 500) {
          assert.doesNotMatch(response.body, /private/u);
        }
      }
    }
  }
});

test("real resource validation, permission hooks and completion failures retain HTTP semantics", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("books", (table) => {
    table.increments("id");
    table.string("title").notNullable();
  });
  const api = await createJsonRestApiHost({ knex, logger: { error() {} } });
  await api.addResource("books", { schema: { title: { type: "string", required: true } } });
  await api.customize({ hooks: {
    checkPermissions({ context }) {
      if ((context.originalContext ?? context).deny) {
        throw new RestApiResourceError("Book access denied.", { subtype: "forbidden" });
      }
    },
    afterCommit({ context }) {
      if (context.failAfterCommit) {
        throw new Error("private notification failure");
      }
    }
  } });
  registerApiErrorHandler(app, { isAppError });
  const transport = createJsonApiResourceRouteTransport({ type: "books" });
  for (const jsonapi of [false, true]) {
    const prefix = `/${jsonapi ? "jsonapi" : "plain"}`;
    const options = { config: jsonapi ? { transport: { runtime: transport } } : {} };
    app.get(`${prefix}/denied`, options, async () => api.resources.books.query({}, { deny: true }));
    app.post(`${prefix}/invalid`, options, async (request) => api.resources.books.post({ data: request.body }));
    app.post(`${prefix}/committed`, options, async (request) => api.resources.books.post({ data: request.body }, { failAfterCommit: true }));
  }

  for (const jsonapi of [false, true]) {
    const prefix = `/${jsonapi ? "jsonapi" : "plain"}`;
    for (const [path, method, payload, status, code, outcome] of [
      ["denied", "GET", undefined, 403, "REST_API_RESOURCE", undefined],
      ["invalid", "POST", {}, 422, "REST_API_VALIDATION", "rolledBack"],
      ["committed", "POST", { title: "Stored book" }, 500, "REST_API_WRITE", "committed"]
    ]) {
      const response = await app.inject({ method, url: `${prefix}/${path}`, ...(payload ? { payload } : {}) });
      assert.equal(response.statusCode, status, response.body);
      const clientError = createHttpError({ status: response.statusCode }, response.json());
      assert.equal(clientError.status, status);
      assert.equal(clientError.code, code);
      assert.equal(clientError.transactionOutcome, outcome);
      if (status === 500) {
        assert.equal(clientError.message, "Internal server error.");
        assert.doesNotMatch(response.body, /private/u);
      }
    }
  }
  assert.deepEqual(await knex("books").pluck("title"), ["Stored book", "Stored book"]);
});

test("error handler, JSON:API transport and client preserve outcomes without disclosing internal failures", () => {
  const transport = createJsonApiResourceRouteTransport({ type: "books" });
  const app = { log: { error() {} }, setErrorHandler(handler) { this.errorHandler = handler; } };
  registerApiErrorHandler(app, { isAppError });

  for (const transactionOutcome of ["none", "pending", "committed", "rolledBack", "unknown", "invalid", undefined]) {
    const failure = Object.assign(new Error("Private SQL statement"), {
      transactionOutcome,
      code: "REST_API_WRITE",
      fieldErrors: { secret: "Private SQL value" },
      cause: { secret: "Private cause" },
      cleanupErrors: [{ message: "Private cleanup" }]
    });
    for (const jsonapi of [false, true]) {
      const reply = {
        statusCode: 200,
        headers: {},
        code(value) { this.statusCode = value; return this; },
        header(name, value) { this.headers[name] = value; return this; },
        send(payload) { this.payload = payload; return this; }
      };
      app.errorHandler(failure, jsonapi ? { routeTransport: transport } : {}, reply);
      assert.equal(reply.statusCode, 500);
      const clientError = createHttpError({ status: reply.statusCode }, reply.payload);
      assert.equal(clientError.message, "Internal server error.");
      assert.equal(clientError.code, "REST_API_WRITE");
      assert.equal(clientError.transactionOutcome, transactionOutcome === "invalid" ? undefined : transactionOutcome);
      assert.equal(clientError.cause, undefined);
      assert.equal(clientError.fieldErrors, null);
      assert.equal(JSON.stringify(reply.payload).includes("Private"), false);
      if (jsonapi) {
        assert.equal(reply.headers["Content-Type"], JSON_API_CONTENT_TYPE);
        assert.equal(reply.payload.errors[0].meta?.transactionOutcome, clientError.transactionOutcome);
      }
    }
  }
});

test("JSON:API field errors retain outcomes and permission details remain private", () => {
  const transport = createJsonApiResourceRouteTransport({ type: "books" });
  const payload = transport.error({
    message: "Validation failed.",
    transactionOutcome: "rolledBack",
    fieldErrors: { title: "Required", author: "Missing" }
  }, { statusCode: 422 });
  assert.equal(payload.errors.length, 2);
  assert.ok(payload.errors.every((error) => error.meta.transactionOutcome === "rolledBack"));

  const app = { log: { error() {} }, setErrorHandler(handler) { this.errorHandler = handler; } };
  registerApiErrorHandler(app, { isAppError });
  const reply = {
    code() { return this; },
    header() { return this; },
    send(value) { this.payload = value; return this; }
  };
  app.errorHandler(new AppError(403, "Forbidden.", {
    code: "ACTION_PERMISSION_DENIED",
    details: { fieldErrors: { secret: "Required private permission" } }
  }), { routeTransport: transport }, reply);
  assert.deepEqual(reply.payload, {
    errors: [{ status: "403", code: "ACTION_PERMISSION_DENIED", title: "Forbidden." }]
  });
});

test("createJsonApiResourceQueryTransportSchema and route transport map list query params to JSON:API", () => {
  const schema = createJsonApiResourceQueryTransportSchema({
    query: CONTACT_LIST_QUERY_SCHEMA,
    responseType: "contacts"
  });

  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(Object.hasOwn(schema.properties, "page[cursor]"));
  assert.ok(Object.hasOwn(schema.properties, "page[limit]"));
  assert.ok(Object.hasOwn(schema.properties, "filter[q]"));
  assert.ok(Object.hasOwn(schema.properties, "include"));
  assert.ok(Object.hasOwn(schema.properties, "filter[workspaceId]"));
  assert.ok(Object.hasOwn(schema.properties, "fields"));
  assert.ok(Object.hasOwn(schema.patternProperties, "^fields\\[[^\\[\\]]+\\]$"));

  assert.deepEqual(
    encodeJsonApiResourceQueryObject({
      fields: {
        contacts: ["id", "name"],
        workspaces: ["id", "slug"]
      }
    }, {
      responseType: "contacts"
    }),
    {
      "fields[contacts]": "id,name",
      "fields[workspaces]": "id,slug"
    }
  );

  const transport = createJsonApiResourceRouteTransport({
    type: "contacts",
    query: CONTACT_LIST_QUERY_SCHEMA,
    successKind: "collection"
  });

  const plainQuery = transport.request.query({
    "page[cursor]": "cursor_2",
    "page[limit]": "10",
    "filter[q]": "Merc",
    include: "workspace",
    "filter[workspaceId]": "7",
    "fields[contacts]": "id,name",
    "fields[workspaces]": "id,slug"
  });

  assert.deepEqual(plainQuery, {
    cursor: "cursor_2",
    limit: "10",
    q: "Merc",
    include: "workspace",
    workspaceId: "7",
    fields: {
      contacts: ["id", "name"],
      workspaces: ["id", "slug"]
    }
  });

  assert.deepEqual(
    transport.request.query({
      fields: "name,id"
    }),
    {
      fields: {
        contacts: ["id", "name"]
      }
    }
  );
});

test("sparse JSON:API response contracts preserve field types without requiring every attribute", () => {
  const schema = createJsonApiResourceSuccessTransportSchema({
    type: "contacts",
    attributes: CONTACT_RECORD_SCHEMA,
    kind: "collection",
    allowSparseFields: true
  });
  const resourceSchema = schema.definitions.contactsSuccessResource;
  const attributesSchemaName = resourceSchema.properties.attributes.allOf[0].$ref
    .replace("#/definitions/", "");
  const attributesSchema = schema.definitions[attributesSchemaName];

  assert.deepEqual(resourceSchema.required, ["type", "id"]);
  assert.equal(Object.hasOwn(attributesSchema, "required"), false);
  assert.equal(attributesSchema.additionalProperties, false);
  assert.equal(attributesSchema.properties.subscribed.anyOf[0].type, "boolean");
});

test("createJsonApiResourceRouteContract produces route options compatible with kernel route validator", () => {
  const contract = createJsonApiResourceRouteContract({
    requestType: "contact-updates",
    responseType: "contacts",
    body: CONTACT_BODY_SCHEMA,
    query: CONTACT_LIST_QUERY_SCHEMA,
    output: CONTACT_RECORD_SCHEMA,
    outputKind: "record",
    successStatus: 201,
    includeValidation400: true
  });

  const resolved = resolveRouteValidatorOptions({
    method: "POST",
    path: "/api/contacts",
    options: {
      transport: contract.transport,
      body: contract.body,
      query: contract.query,
      responses: contract.responses,
      advanced: contract.advanced
    }
  });

  assert.equal(resolved.transport.kind, "jsonapi-resource");
  assert.equal(resolved.transport.contentType, JSON_API_CONTENT_TYPE);
  assert.equal(resolved.schema.body.required[0], "data");
  assert.ok(Object.hasOwn(resolved.schema.querystring.properties, "page[cursor]"));
  assert.ok(Object.hasOwn(resolved.schema.querystring.properties, "filter[q]"));
  assert.equal(resolved.schema.response["201"].required[0], "data");
  assert.equal(resolved.schema.response["400"].required[0], "errors");
  assert.equal(resolved.schema.body.definitions["contact-updatesRequestResource"].properties.type.const, "contact-updates");
  assert.equal(resolved.schema.response["201"].definitions.contactsSuccessResource.properties.type.const, "contacts");

  const unwrappedBody = resolved.transport.request.body({
    data: {
      type: "contact-updates",
      attributes: {
        name: "Merc",
        subscribed: true
      }
    }
  });

  assert.deepEqual(resolved.input.body(unwrappedBody), {
    name: "Merc",
    subscribed: true
  });

  const unwrappedQuery = resolved.transport.request.query({
    "page[cursor]": "cursor_3",
    "filter[q]": "Merc"
  });

  assert.deepEqual(resolved.input.query(unwrappedQuery), {
    cursor: "cursor_3",
    q: "Merc"
  });
});

test("createJsonApiResourceRouteTransport passes through tagged JSON:API document results", () => {
  const transport = createJsonApiResourceRouteTransport({
    type: "contacts",
    successKind: "record"
  });

  const document = {
    data: {
      type: "contacts",
      id: "1",
      attributes: {
        name: "Merc",
        subscribed: true
      }
    }
  };

  assert.deepEqual(transport.response(returnJsonApiDocument(document)), document);
});

test("createJsonApiResourceRouteContract models explicit relationship-backed output fields as relationships", () => {
  const contract = createJsonApiResourceRouteContract({
    responseType: "availabilities",
    output: {
      schema: createSchema({
        id: {
          type: "string",
          required: true,
          minLength: 1
        },
        serviceId: {
          type: "string",
          required: true,
          nullable: true,
          belongsTo: "services",
          as: "service"
        },
        name: {
          type: "string",
          required: true,
          minLength: 1
        },
        deletedAt: {
          type: "string",
          required: true,
          nullable: true
        },
        lookups: {
          type: "object",
          required: false
        }
      }),
      mode: "replace"
    },
    outputKind: "record",
    outputAttributeExcludeKeys: ["lookups"],
    outputRelationshipEntries: [
      {
        attributeKey: "serviceId",
        relationshipName: "service",
        relationshipType: "services",
        nullable: true
      }
    ]
  });

  const resourceSchema = contract.responses["200"].transportSchema.definitions.availabilitiesSuccessResource;
  const attributesSchemaRef = resourceSchema.properties.attributes.allOf[0].$ref;
  const attributesSchemaName = attributesSchemaRef.replace("#/definitions/", "");
  const attributesSchema = contract.responses["200"].transportSchema.definitions[attributesSchemaName];

  assert.deepEqual(resourceSchema.required, ["type", "attributes", "id"]);
  assert.ok(Object.hasOwn(resourceSchema.properties, "relationships"));
  assert.equal(attributesSchema.required.includes("serviceId"), false);
  assert.equal(attributesSchema.required.includes("deletedAt"), false);
  assert.equal(attributesSchema.required.includes("lookups"), false);
  assert.equal(Object.hasOwn(attributesSchema.properties, "serviceId"), false);
  assert.equal(Object.hasOwn(attributesSchema.properties, "deletedAt"), true);
  assert.equal(Object.hasOwn(attributesSchema.properties, "lookups"), false);
  assert.equal(
    Array.isArray(resourceSchema.properties.relationships.required),
    false
  );
  assert.equal(
    resourceSchema.properties.relationships.properties.service.properties.data.anyOf[1].type,
    "null"
  );
  assert.ok(Object.hasOwn(contract.responses["200"].transportSchema.properties, "included"));
});

test("createJsonApiResourceRouteContract models to-many relationship output fields", () => {
  const contract = createJsonApiResourceRouteContract({
    responseType: "contacts",
    output: {
      schema: createSchema({
        id: {
          type: "string",
          required: true,
          minLength: 1
        },
        name: {
          type: "string",
          required: true,
          minLength: 1
        },
        pets: {
          type: "array",
          required: false
        }
      }),
      mode: "replace"
    },
    outputKind: "record",
    outputRelationshipEntries: [
      {
        attributeKey: "pets",
        relationshipName: "pets",
        relationshipType: "pets",
        many: true
      }
    ]
  });

  const resourceSchema = contract.responses["200"].transportSchema.definitions.contactsSuccessResource;
  const attributesSchemaRef = resourceSchema.properties.attributes.allOf[0].$ref;
  const attributesSchemaName = attributesSchemaRef.replace("#/definitions/", "");
  const attributesSchema = contract.responses["200"].transportSchema.definitions[attributesSchemaName];
  const relationshipDataSchema = resourceSchema.properties.relationships.properties.pets.properties.data;

  assert.equal(Object.hasOwn(attributesSchema.properties, "pets"), false);
  assert.equal(relationshipDataSchema.anyOf[0].type, "array");
  assert.equal(relationshipDataSchema.anyOf[0].items.properties.type.const, "pets");
});

test("createJsonApiResourceRouteTransport wraps tagged meta results for meta routes", () => {
  const contract = createJsonApiResourceRouteContract({
    requestType: "password-changes",
    body: CONTACT_BODY_SCHEMA,
    output: {
      schema: createSchema({
        message: {
          type: "string",
          required: true,
          minLength: 1
        }
      }),
      mode: "replace"
    },
    outputKind: "meta",
    successStatus: 200
  });

  assert.equal(contract.transport.kind, "jsonapi-resource");
  assert.equal(contract.responses["200"].transportSchema.required[0], "meta");
  assert.deepEqual(
    contract.transport.response(returnJsonApiMeta({
      message: "Password updated."
    })),
    {
      meta: {
        message: "Password updated."
      }
    }
  );
});

test("createJsonApiResourceRouteTransport rejects untagged success payloads", () => {
  const transport = createJsonApiResourceRouteTransport({
    type: "contacts",
    successKind: "record"
  });

  assert.throws(() => {
    transport.response({
      id: "1",
      name: "Merc"
    });
  }, /explicit JSON:API result wrapper/);
});
