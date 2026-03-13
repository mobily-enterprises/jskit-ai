import assert from "node:assert/strict";
import test from "node:test";

import { createRouter } from "./router.js";
import { compileRouteContract, defineRouteContract, resolveRouteContractOptions } from "./routeContract.js";

test("defineRouteContract compiles body/query/params and maps query schema to querystring", () => {
  const bodySchema = {
    type: "object"
  };
  const querySchema = {
    type: "object"
  };
  const paramsSchema = {
    type: "object"
  };
  const responseSchema = {
    200: {
      schema: {
        type: "object"
      }
    }
  };
  const headersSchema = {
    type: "object"
  };

  const normalizeBody = (body) => body;
  const normalizeQuery = (query) => query;
  const normalizeParams = (params) => params;

  const contract = defineRouteContract({
    meta: {
      tags: ["contacts", "intake"],
      summary: "Create contact intake"
    },
    body: {
      schema: bodySchema,
      normalize: normalizeBody
    },
    query: {
      schema: querySchema,
      normalize: normalizeQuery
    },
    params: {
      schema: paramsSchema
    },
    response: responseSchema,
    advanced: {
      fastifySchema: {
        headers: headersSchema
      },
      jskitInput: {
        params: normalizeParams
      }
    }
  });

  const compiled = contract.toRouteOptions();

  assert.deepEqual(compiled.schema, {
    tags: ["contacts", "intake"],
    summary: "Create contact intake",
    body: bodySchema,
    querystring: querySchema,
    params: paramsSchema,
    response: {
      200: {
        type: "object"
      }
    },
    headers: headersSchema
  });
  assert.equal(compiled.input.body, normalizeBody);
  assert.equal(compiled.input.query, normalizeQuery);
  assert.equal(compiled.input.params, normalizeParams);
});

test("compileRouteContract accepts plain contract objects", () => {
  const querySchema = {
    type: "object"
  };
  const normalizeQuery = (query) => ({
    dryRun: Boolean(query?.dryRun)
  });

  const compiled = compileRouteContract({
    query: {
      schema: querySchema,
      normalize: normalizeQuery
    }
  });

  assert.deepEqual(compiled.schema, {
    querystring: querySchema
  });
  assert.equal(compiled.input.query, normalizeQuery);
});

test("compileRouteContract creates pass-through request.input transforms for schema-only params and query", () => {
  const querySchema = {
    type: "object"
  };
  const paramsSchema = {
    type: "object"
  };

  const compiled = compileRouteContract({
    query: {
      schema: querySchema
    },
    params: {
      schema: paramsSchema
    }
  });

  assert.deepEqual(compiled.schema, {
    querystring: querySchema,
    params: paramsSchema
  });
  assert.equal(typeof compiled.input.query, "function");
  assert.equal(typeof compiled.input.params, "function");
  assert.deepEqual(compiled.input.query({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
  assert.deepEqual(compiled.input.params({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
});

test("compileRouteContract accepts response contract objects and extracts only response schemas", () => {
  const responseBodySchema = {
    type: "object"
  };
  const normalizeOutput = (payload) => ({
    ...payload,
    normalized: true
  });

  const compiled = compileRouteContract({
    response: {
      200: {
        schema: responseBodySchema,
        normalize: normalizeOutput
      },
      400: {
        schema: {
          type: "object"
        }
      }
    }
  });

  assert.deepEqual(compiled.schema, {
    response: {
      200: responseBodySchema,
      400: {
        type: "object"
      }
    }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(compiled, "output"), false);
});

test("compileRouteContract merges query contract arrays automatically", () => {
  const paginationQuery = {
    schema: {
      type: "object",
      properties: {
        cursor: {
          type: "string"
        }
      },
      additionalProperties: false
    }
  };
  const searchQuery = {
    schema: {
      type: "object",
      properties: {
        search: {
          type: "string"
        }
      },
      additionalProperties: false
    }
  };

  const compiled = compileRouteContract({
    query: [paginationQuery, searchQuery]
  });

  assert.deepEqual(compiled.schema, {
    querystring: {
      type: "object",
      properties: {
        cursor: {
          type: "string"
        },
        search: {
          type: "string"
        }
      },
      required: ["cursor", "search"],
      additionalProperties: false
    }
  });
});

test("compileRouteContract merges params contract arrays automatically", () => {
  const workspaceSlugParams = {
    schema: {
      type: "object",
      properties: {
        workspaceSlug: {
          type: "string"
        }
      },
      required: ["workspaceSlug"],
      additionalProperties: false
    }
  };
  const inviteIdParams = {
    schema: {
      type: "object",
      properties: {
        inviteId: {
          type: "string"
        }
      },
      required: ["inviteId"],
      additionalProperties: false
    }
  };

  const compiled = compileRouteContract({
    params: [workspaceSlugParams, inviteIdParams]
  });

  assert.deepEqual(compiled.schema, {
    params: {
      type: "object",
      properties: {
        workspaceSlug: {
          type: "string"
        },
        inviteId: {
          type: "string"
        }
      },
      required: ["workspaceSlug", "inviteId"],
      additionalProperties: false
    }
  });
});

test("compileRouteContract composes multiple query normalizers in contract arrays", () => {
  const compiled = compileRouteContract({
    query: [
      {
        schema: {
          type: "object",
          properties: {
            cursor: {
              type: "string"
            }
          },
          additionalProperties: false
        },
        normalize(query = {}) {
          return {
            cursor: String(query.cursor || "").trim()
          };
        }
      },
      {
        schema: {
          type: "object",
          properties: {
            search: {
              type: "string"
            }
          },
          additionalProperties: false
        },
        normalize(query = {}) {
          return {
            search: String(query.search || "").trim().toLowerCase()
          };
        }
      }
    ]
  });

  assert.deepEqual(compiled.input.query({ cursor: " 100 ", search: " ACME " }), {
    cursor: "100",
    search: "acme"
  });
});

test("resolveRouteContractOptions ignores legacy schema/input definitions", () => {
  const resolved = resolveRouteContractOptions({
    method: "POST",
    path: "/contacts",
    options: {
      schema: {
        body: {}
      },
      input: {
        body: () => ({})
      },
      middleware: ["api"]
    }
  });

  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "schema"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "input"), false);
  assert.deepEqual(resolved.middleware, ["api"]);
});

test("resolveRouteContractOptions supports inline contract shape without wrapper", () => {
  const bodySchema = {
    type: "object"
  };
  const normalizeBody = (body) => ({
    name: String(body?.name || "").trim()
  });

  const resolved = resolveRouteContractOptions({
    method: "POST",
    path: "/contacts",
    options: {
      meta: {
        tags: ["contacts"],
        summary: "Create contact"
      },
      body: {
        schema: bodySchema,
        normalize: normalizeBody
      },
      middleware: ["api"]
    }
  });

  assert.deepEqual(resolved.schema, {
    tags: ["contacts"],
    summary: "Create contact",
    body: bodySchema
  });
  assert.equal(resolved.input.body, normalizeBody);
  assert.deepEqual(resolved.middleware, ["api"]);
});

test("resolveRouteContractOptions ignores contract wrapper", () => {
  const resolved = resolveRouteContractOptions({
    method: "POST",
    path: "/contacts",
    options: {
      contract: defineRouteContract({}),
      middleware: ["api"]
    }
  });

  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "contract"), false);
  assert.deepEqual(resolved.middleware, ["api"]);
});

test("defineRouteContract rejects unsupported advanced.jskitInput keys", () => {
  assert.throws(
    () =>
      defineRouteContract({
        advanced: {
          jskitInput: {
            headers: () => ({})
          }
        }
      }),
    /advanced\.jskitInput\.headers is not supported/
  );
});

test("defineRouteContract validates meta fields", () => {
  assert.throws(
    () =>
      defineRouteContract({
        meta: {
          tags: ["ok", ""]
        }
      }),
    /meta\.tags\[1\] must be a non-empty string/
  );

  assert.throws(
    () =>
      defineRouteContract({
        meta: {
          summary: ""
        }
      }),
    /meta\.summary must be a non-empty string/
  );
});

test("HttpRouter.register ignores contract wrapper options", () => {
  const router = createRouter();
  router.register(
    "POST",
    "/contacts",
    {
      contract: defineRouteContract({})
    },
    async () => {}
  );

  const [route] = router.list();
  assert.equal(route.schema, undefined);
  assert.equal(route.input, null);
});

test("HttpRouter.register ignores compiled legacy-style route options", () => {
  const router = createRouter();
  const querySchema = {
    type: "object"
  };
  const normalizeQuery = (query) => ({
    dryRun: query?.dryRun === true
  });

  const contract = defineRouteContract({
    query: {
      schema: querySchema,
      normalize: normalizeQuery
    }
  });

  router.get(
    "/contacts",
    contract.toRouteOptions(),
    async () => {}
  );

  const [route] = router.list();
  assert.equal(route.schema, undefined);
  assert.equal(route.input, null);
});

test("HttpRouter.register accepts inline contract shape directly", () => {
  const router = createRouter();
  const querySchema = {
    type: "object"
  };
  const normalizeQuery = (query) => ({
    dryRun: query?.dryRun === true
  });

  router.get(
    "/contacts",
    {
      meta: {
        tags: ["contacts"],
        summary: "List contacts"
      },
      query: {
        schema: querySchema,
        normalize: normalizeQuery
      }
    },
    async () => {}
  );

  const [route] = router.list();
  assert.deepEqual(route.schema, {
    tags: ["contacts"],
    summary: "List contacts",
    querystring: querySchema
  });
  assert.equal(route.input.query, normalizeQuery);
});
