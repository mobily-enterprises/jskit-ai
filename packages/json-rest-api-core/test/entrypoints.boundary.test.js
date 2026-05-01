import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  buildJsonRestQueryParams,
  createJsonApiInputRecord,
  createJsonApiRelationship,
  createJsonRestContext,
  createJsonRestApiHost,
  registerJsonRestApiHost,
  resolveWorkspaceScopeValue,
  resolveUserScopeValue,
  simplifyJsonApiDocument
} from "../src/server/jsonRestApiHost.js";
import { JsonRestApiCoreServiceProvider } from "../src/server/JsonRestApiCoreServiceProvider.js";

test("package exports include explicit server jsonRestApiHost entrypoint only", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(exportsMap["./server/jsonRestApiHost"], "./src/server/jsonRestApiHost.js");
  assert.equal(exportsMap["./server"], undefined);
});

test("server entrypoint exports shared host helpers", () => {
  assert.equal(INTERNAL_JSON_REST_API, "internal.json-rest-api");
  assert.equal(typeof addResourceIfMissing, "function");
  assert.equal(typeof buildJsonRestQueryParams, "function");
  assert.equal(typeof createJsonApiInputRecord, "function");
  assert.equal(typeof createJsonApiRelationship, "function");
  assert.equal(typeof createJsonRestContext, "function");
  assert.equal(typeof createJsonRestApiHost, "function");
  assert.equal(typeof registerJsonRestApiHost, "function");
  assert.equal(typeof resolveWorkspaceScopeValue, "function");
  assert.equal(typeof resolveUserScopeValue, "function");
  assert.equal(typeof simplifyJsonApiDocument, "function");
  assert.equal(typeof JsonRestApiCoreServiceProvider, "function");
});

test("createJsonRestContext returns a mutable clone for frozen JSKIT execution context", () => {
  const source = Object.freeze({
    visibilityContext: Object.freeze({
      visibility: "workspace",
      scopeOwnerId: "workspace-7",
      userId: "user-2"
    }),
    scopeValues: Object.freeze({
      workspaceId: "workspace-explicit"
    }),
    requestMeta: Object.freeze({
      traceId: "trace-1"
    })
  });

  const result = createJsonRestContext(source);

  assert.notEqual(result, source);
  assert.notEqual(result.visibilityContext, source.visibilityContext);
  assert.notEqual(result.scopeValues, source.scopeValues);
  assert.equal(result.requestMeta, source.requestMeta);

  result.method = "query";
  result.scopeValues.userId = "user-2";

  assert.equal(result.method, "query");
  assert.equal(result.scopeValues.userId, "user-2");
  assert.equal(source.scopeValues.userId, undefined);
});

test("createJsonRestContext returns an empty mutable object when source context is absent", () => {
  const result = createJsonRestContext(null);

  assert.deepEqual(result, {});
  result.method = "query";
  assert.equal(result.method, "query");
});

test("shared query/document helpers build json-rest-api request shapes", () => {
  assert.deepEqual(
    buildJsonRestQueryParams("contacts", {
      q: "Merc",
      cursor: "cursor_2",
      limit: 10,
      include: "workspace,user",
      sort: ["-createdAt", "name"],
      fields: "name,dob"
    }),
    {
      filters: {
        q: "Merc"
      },
      include: ["workspace", "user"],
      sort: ["-createdAt", "name"],
      page: {
        after: "cursor_2",
        size: "10"
      },
      fields: {
        contacts: "name,dob"
      }
    }
  );

  assert.deepEqual(
    createJsonApiInputRecord("contacts", {
      name: "Merc"
    }, {
      id: 7,
      relationships: {
        workspace: createJsonApiRelationship("workspaces", 9)
      }
    }),
    {
      data: {
        type: "contacts",
        id: "7",
        attributes: {
          name: "Merc"
        },
        relationships: {
          workspace: {
            data: {
              type: "workspaces",
              id: "9"
            }
          }
        }
      }
    }
  );

  assert.deepEqual(
    simplifyJsonApiDocument({
      data: [
        {
          type: "workspace-memberships",
          id: "11",
          attributes: {
            roleSid: "owner"
          },
          relationships: {
            user: {
              data: {
                type: "user-profiles",
                id: "9"
              }
            }
          }
        }
      ],
      included: [
        {
          type: "user-profiles",
          id: "9",
          attributes: {
            displayName: "Chiara"
          }
        }
      ]
    }),
    [
      {
        id: "11",
        roleSid: "owner",
        user: {
          id: "9",
          displayName: "Chiara"
        }
      }
    ]
  );
});

test("scope resolvers understand explicit scopeValues and JSKIT visibilityContext", () => {
  assert.equal(resolveWorkspaceScopeValue({
    scopeValues: {
      workspaceId: "workspace-explicit"
    },
    visibilityContext: {
      scopeOwnerId: "workspace-visibility"
    }
  }), "workspace-explicit");

  assert.equal(resolveWorkspaceScopeValue({
    visibilityContext: {
      scopeOwnerId: 42
    }
  }), "42");

  assert.equal(resolveUserScopeValue({
    scopeValues: {
      userId: "user-explicit"
    },
    visibilityContext: {
      userId: "user-visibility"
    }
  }), "user-explicit");

  assert.equal(resolveUserScopeValue({
    visibilityContext: {
      userId: 7
    }
  }), "7");

  assert.equal(resolveWorkspaceScopeValue({
    visibilityContext: {
      scopeOwnerId: "   "
    }
  }), null);
  assert.equal(resolveUserScopeValue(null), null);
});
