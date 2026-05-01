import assert from "node:assert/strict";
import test from "node:test";

import {
  JSON_API_CONTENT_TYPE,
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
    "filter[workspaceId]": "7"
  });

  assert.deepEqual(plainQuery, {
    cursor: "cursor_2",
    limit: "10",
    q: "Merc",
    include: "workspace",
    workspaceId: "7"
  });
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
