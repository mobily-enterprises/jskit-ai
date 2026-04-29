import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createRouter } from "./router.js";
import { compileRouteValidator, defineRouteValidator, resolveRouteValidatorOptions } from "./routeValidator.js";

function createMockJsonRestSchema() {
  return {
    async create(payload = {}) {
      const name = String(payload?.name || "").trim();
      const errors = {};
      if (!name) {
        errors.name = {
          message: "Name is required."
        };
      }

      return {
        validatedObject: Object.keys(errors).length < 1 ? { name } : {},
        errors
      };
    },
    async replace(payload = {}) {
      return this.create(payload);
    },
    async patch(payload = {}) {
      return this.create(payload);
    },
    toJsonSchema() {
      return {
        type: "object",
        properties: {
          name: {
            type: "string"
          }
        },
        additionalProperties: false
      };
    }
  };
}

test("defineRouteValidator compiles body/query/params and maps query schema to querystring", () => {
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

  const validator = defineRouteValidator({
    meta: {
      tags: ["contacts", "intake"],
      summary: "Create contact intake"
    },
    body: {
      schema: bodySchema
    },
    query: {
      schema: querySchema
    },
    params: {
      schema: paramsSchema
    },
    responses: responseSchema,
    advanced: {
      fastifySchema: {
        headers: headersSchema
      },
      jskitInput: {
        body: normalizeBody,
        query: normalizeQuery,
        params: normalizeParams
      }
    }
  });

  const compiled = validator.toRouteOptions();

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

test("compileRouteValidator accepts plain validator objects", () => {
  const querySchema = {
    type: "object"
  };

  const compiled = compileRouteValidator({
    query: {
      schema: querySchema
    }
  });

  assert.deepEqual(compiled.schema, {
    querystring: querySchema
  });
  assert.equal(typeof compiled.input.query, "function");
});

test("compileRouteValidator creates async pass-through request.input transforms for schema-only params and query", async () => {
  const querySchema = {
    type: "object"
  };
  const paramsSchema = {
    type: "object"
  };

  const compiled = compileRouteValidator({
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
  assert.deepEqual(await compiled.input.query({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
  assert.deepEqual(await compiled.input.params({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
});

test("compileRouteValidator accepts response schema definitions and extracts only response schemas", () => {
  const responseBodySchema = {
    type: "object"
  };

  const compiled = compileRouteValidator({
    responses: {
      200: {
        schema: responseBodySchema
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

test("compileRouteValidator merges query validator arrays automatically", () => {
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

  const compiled = compileRouteValidator({
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
      additionalProperties: false
    }
  });
});

test("compileRouteValidator merges params validator arrays automatically", () => {
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

  const compiled = compileRouteValidator({
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

test("compileRouteValidator composes json-rest-schema query arrays into one async transform", async () => {
  const compiled = compileRouteValidator({
    query: [
      {
        schema: createSchema({
          cursor: {
            type: "string",
            required: false,
            minLength: 1
          }
        }),
        mode: "patch"
      },
      {
        schema: createSchema({
          search: {
            type: "string",
            required: false,
            lowercase: true,
            minLength: 1
          }
        }),
        mode: "patch"
      }
    ]
  });

  assert.deepEqual(await compiled.input.query({ cursor: "100", search: "ACME" }), {
    cursor: "100",
    search: "acme"
  });
});

test("compileRouteValidator turns json-rest-schema validators into transport schema plus async input normalization", async () => {
  const compiled = compileRouteValidator({
    body: {
      schema: createMockJsonRestSchema(),
      mode: "patch"
    }
  });

  assert.deepEqual(compiled.schema, {
    body: {
      type: "object",
      properties: {
        name: {
          type: "string"
        }
      },
      additionalProperties: false
    }
  });

  const normalized = await compiled.input.body({
    name: "  Acme  "
  });
  assert.deepEqual(normalized, {
    name: "Acme"
  });
});

test("resolveRouteValidatorOptions ignores legacy schema/input definitions", () => {
  const resolved = resolveRouteValidatorOptions({
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

test("resolveRouteValidatorOptions supports inline validator shape without wrapper", () => {
  const bodySchema = {
    type: "object"
  };
  const normalizeBody = (body) => ({
    name: String(body?.name || "").trim()
  });

  const resolved = resolveRouteValidatorOptions({
    method: "POST",
    path: "/contacts",
    options: {
      meta: {
        tags: ["contacts"],
        summary: "Create contact"
      },
      body: {
        schema: bodySchema
      },
      advanced: {
        jskitInput: {
          body: normalizeBody
        }
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

test("resolveRouteValidatorOptions ignores validator wrapper", () => {
  const resolved = resolveRouteValidatorOptions({
    method: "POST",
    path: "/contacts",
    options: {
      validator: defineRouteValidator({}),
      middleware: ["api"]
    }
  });

  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "validator"), false);
  assert.deepEqual(resolved.middleware, ["api"]);
});

test("defineRouteValidator rejects unsupported advanced.jskitInput keys", () => {
  assert.throws(
    () =>
      defineRouteValidator({
        advanced: {
          jskitInput: {
            headers: () => ({})
          }
        }
      }),
    /advanced\.jskitInput\.headers is not supported/
  );
});

test("defineRouteValidator rejects unsupported top-level keys generically", () => {
  assert.throws(
    () =>
      defineRouteValidator({
        legacyContract: {
          schema: {
            type: "object"
          }
        }
      }),
    /defineRouteValidator\(\)\.legacyContract is not supported/
  );
});

test("defineRouteValidator validates meta fields", () => {
  assert.throws(
    () =>
      defineRouteValidator({
        meta: {
          tags: ["ok", ""]
        }
      }),
    /meta\.tags\[1\] must be a non-empty string/
  );

  assert.throws(
    () =>
      defineRouteValidator({
        meta: {
          summary: ""
        }
      }),
    /meta\.summary must be a non-empty string/
  );
});

test("HttpRouter.register ignores validator wrapper options", () => {
  const router = createRouter();
  router.register(
    "POST",
    "/contacts",
    {
      validator: defineRouteValidator({})
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

  const validator = defineRouteValidator({
    query: {
      schema: querySchema,
      normalize: normalizeQuery
    }
  });

  router.get(
    "/contacts",
    validator.toRouteOptions(),
    async () => {}
  );

  const [route] = router.list();
  assert.equal(route.schema, undefined);
  assert.equal(route.input, null);
});

test("HttpRouter.register accepts inline validator shape directly", () => {
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
        schema: querySchema
      },
      advanced: {
        jskitInput: {
          query: normalizeQuery
        }
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
