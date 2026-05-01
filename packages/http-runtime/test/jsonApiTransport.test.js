import assert from "node:assert/strict";
import test from "node:test";

import {
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiResourceObject,
  isJsonApiContentType,
  isJsonContentType,
  normalizeJsonApiDocument,
  simplifyJsonApiDocument
} from "../src/shared/index.js";

test("json transport helpers recognize json and json:api media types", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("application/vnd.api+json"), true);
  assert.equal(isJsonContentType("application/problem+json; charset=utf-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);

  assert.equal(isJsonApiContentType(JSON_API_CONTENT_TYPE), true);
  assert.equal(isJsonApiContentType("application/vnd.api+json; charset=utf-8"), true);
  assert.equal(isJsonApiContentType("application/json"), false);
});

test("createJsonApiDocument builds normalized resource and collection documents", () => {
  const invite = createJsonApiResourceObject({
    type: "workspace-invites",
    id: "9",
    attributes: {
      email: "tony@example.com"
    },
    relationships: {
      workspace: {
        data: {
          type: "workspaces",
          id: "1"
        }
      }
    }
  });

  const document = createJsonApiDocument({
    data: [invite],
    included: [
      createJsonApiResourceObject({
        type: "workspaces",
        id: "1",
        attributes: {
          name: "Acme"
        }
      })
    ],
    links: {
      self: "/api/w/acme/invites"
    },
    meta: {
      pageSize: 20
    }
  });

  assert.equal(Array.isArray(document.data), true);
  assert.equal(document.data[0].type, "workspace-invites");
  assert.equal(document.included[0].type, "workspaces");
  assert.equal(document.links.self, "/api/w/acme/invites");
  assert.equal(document.meta.pageSize, 20);
});

test("normalizeJsonApiDocument preserves compound-document structure", () => {
  const normalized = normalizeJsonApiDocument({
    data: {
      type: "assistant-messages",
      id: "17",
      attributes: {
        contentText: "hello"
      },
      relationships: {
        conversation: {
          data: {
            type: "assistant-conversations",
            id: "2"
          }
        }
      }
    },
    included: [
      {
        type: "assistant-conversations",
        id: "2",
        attributes: {
          title: "Demo"
        }
      }
    ],
    links: {
      self: "/api/assistant/admin/conversations/2/messages"
    },
    meta: {
      page: 1
    }
  });

  assert.equal(normalized.kind, "resource");
  assert.equal(normalized.data.type, "assistant-messages");
  assert.equal(normalized.data.relationships.conversation.data.id, "2");
  assert.equal(normalized.included[0].attributes.title, "Demo");
  assert.equal(normalized.links.self, "/api/assistant/admin/conversations/2/messages");
  assert.equal(normalized.meta.page, 1);
});

test("simplifyJsonApiDocument keeps legacy flat-record behavior for resource and collection documents", () => {
  assert.deepEqual(
    simplifyJsonApiDocument({
      data: {
        type: "contacts",
        id: "3",
        attributes: {
          name: "Tony",
          subscribed: true
        }
      }
    }),
    {
      id: "3",
      name: "Tony",
      subscribed: true
    }
  );

  assert.deepEqual(
    simplifyJsonApiDocument({
      data: [
        {
          type: "contacts",
          id: "3",
          attributes: {
            name: "Tony"
          }
        },
        {
          type: "contacts",
          id: "4",
          attributes: {
            name: "Merc"
          }
        }
      ]
    }),
    [
      {
        id: "3",
        name: "Tony"
      },
      {
        id: "4",
        name: "Merc"
      }
    ]
  );
});

test("createJsonApiErrorDocumentFromFailure maps field errors and validation issues to JSON:API errors", () => {
  assert.deepEqual(
    createJsonApiErrorDocumentFromFailure({
      statusCode: 422,
      code: "invalid_contact",
      message: "Validation failed.",
      fieldErrors: {
        name: "Name is required."
      }
    }),
    {
      errors: [
        {
          status: "422",
          code: "invalid_contact",
          title: "Validation failed.",
          detail: "Name is required.",
          source: {
            pointer: "/data/attributes/name"
          }
        }
      ]
    }
  );

  assert.deepEqual(
    createJsonApiErrorDocumentFromFailure({
      statusCode: 400,
      code: "validation_failed",
      message: "Validation failed.",
      validationIssues: [
        {
          instancePath: "/data/attributes",
          message: "must have required property 'name'",
          params: {
            missingProperty: "name"
          }
        }
      ],
      validationContext: "body"
    }),
    {
      errors: [
        {
          status: "400",
          code: "validation_failed",
          title: "Validation failed.",
          detail: "must have required property 'name'",
          source: {
            pointer: "/data/attributes/name"
          }
        }
      ]
    }
  );
});
