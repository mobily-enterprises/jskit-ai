import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createRouter } from "./router.js";
import { compileRouteValidator, defineRouteValidator, resolveRouteValidatorOptions } from "./routeValidator.js";

function stripJsonRestTransportExtensions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripJsonRestTransportExtensions(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "x-json-rest-schema") {
      continue;
    }

    sanitized[key] = stripJsonRestTransportExtensions(entry);
  }

  return sanitized;
}

function toFastifySchema(schema, mode) {
  return stripJsonRestTransportExtensions(schema.toJsonSchema({ mode }));
}

function createMockJsonRestSchema() {
  return createSchema({
    name: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 160,
      messages: {
        minLength: "Name is required."
      }
    }
  });
}

test("defineRouteValidator compiles body/query/params and maps query schema to querystring", () => {
  const bodySchema = createSchema({
    name: {
      type: "string",
      required: true,
      minLength: 1
    }
  });
  const querySchema = createSchema({
    search: {
      type: "string",
      required: false,
      minLength: 1
    }
  });
  const paramsSchema = createSchema({
    contactId: {
      type: "string",
      required: true,
      minLength: 1
    }
  });
  const responseBodySchema = createSchema({
    ok: {
      type: "boolean",
      required: true
    }
  });
  const responseSchema = {
    200: {
      schema: responseBodySchema
    }
  };
  const headersSchema = {
    type: "object"
  };

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
      }
    }
  });

  const compiled = validator.toRouteOptions();

  assert.deepEqual(compiled.schema, {
    tags: ["contacts", "intake"],
    summary: "Create contact intake",
    body: toFastifySchema(bodySchema, "patch"),
    querystring: toFastifySchema(querySchema, "patch"),
    params: toFastifySchema(paramsSchema, "patch"),
    response: {
      200: toFastifySchema(responseBodySchema, "replace")
    },
    headers: headersSchema
  });
  assert.equal(typeof compiled.input.body, "function");
  assert.equal(typeof compiled.input.query, "function");
  assert.equal(typeof compiled.input.params, "function");
  assert.deepEqual(compiled.input.body({
    name: "  Acme  "
  }), {
    name: "Acme"
  });
});

test("compileRouteValidator accepts json-rest-schema definitions", () => {
  const querySchema = createSchema({
    search: {
      type: "string",
      required: false,
      minLength: 1
    }
  });

  const compiled = compileRouteValidator({
    query: {
      schema: querySchema
    }
  });

  assert.deepEqual(compiled.schema, {
    querystring: toFastifySchema(querySchema, "patch")
  });
  assert.equal(typeof compiled.input.query, "function");
});

test("compileRouteValidator creates request.input transforms for schema-only params and query", () => {
  const querySchema = createSchema({
    workspaceSlug: {
      type: "string",
      required: false,
      minLength: 1
    }
  });
  const paramsSchema = createSchema({
    workspaceSlug: {
      type: "string",
      required: true,
      minLength: 1
    }
  });

  const compiled = compileRouteValidator({
    query: {
      schema: querySchema
    },
    params: {
      schema: paramsSchema
    }
  });

  assert.deepEqual(compiled.schema, {
    querystring: toFastifySchema(querySchema, "patch"),
    params: toFastifySchema(paramsSchema, "patch")
  });
  assert.equal(typeof compiled.input.query, "function");
  assert.equal(typeof compiled.input.params, "function");
  assert.deepEqual(compiled.input.query({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
  assert.deepEqual(compiled.input.params({ workspaceSlug: "acme" }), { workspaceSlug: "acme" });
});

test("compileRouteValidator accepts response schema definitions and extracts only response schemas", () => {
  const responseBodySchema = createSchema({
    ok: {
      type: "boolean",
      required: true
    }
  });

  const compiled = compileRouteValidator({
    responses: {
      200: {
        schema: responseBodySchema
      },
      400: {
        schema: createSchema({
          ok: {
            type: "boolean",
            required: true
          }
        })
      }
    }
  });

  assert.deepEqual(compiled.schema, {
    response: {
      200: toFastifySchema(responseBodySchema, "replace"),
      400: toFastifySchema(createSchema({
        ok: {
          type: "boolean",
          required: true
        }
      }), "replace")
    }
  });
  assert.equal(Object.hasOwn(compiled, "output"), false);
});

test("compileRouteValidator turns json-rest-schema validators into transport schema plus input normalization", () => {
  const bodySchema = createMockJsonRestSchema();
  const compiled = compileRouteValidator({
    body: {
      schema: bodySchema,
      mode: "patch"
    }
  });

  assert.deepEqual(compiled.schema, {
    body: toFastifySchema(bodySchema, "patch")
  });

  const normalized = compiled.input.body({
    name: "  Acme  "
  });
  assert.deepEqual(normalized, {
    name: "Acme"
  });
});

test("compileRouteValidator surfaces shared schema validation errors with HTTP 400 metadata", () => {
  const bodySchema = createMockJsonRestSchema();
  const compiled = compileRouteValidator({
    body: {
      schema: bodySchema,
      mode: "patch"
    }
  });

  assert.throws(
    () => compiled.input.body({ name: "" }),
    (error) => {
      assert.equal(error?.statusCode, 400);
      assert.deepEqual(error?.details?.fieldErrors, {
        name: "Name is required."
      });
      return true;
    }
  );
});

test("compileRouteValidator rejects validator arrays", () => {
  assert.throws(
    () => compileRouteValidator({
      query: [
        {
          schema: createSchema({
            cursor: {
              type: "string",
              required: false
            }
          })
        }
      ]
    }),
    /route validator\.query must be a schema definition object/
  );
});

test("resolveRouteValidatorOptions supports inline validator shape without wrapper", () => {
  const bodySchema = createSchema({
    name: {
      type: "string",
      required: true,
      minLength: 1
    }
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
      middleware: ["api"]
    }
  });

  assert.deepEqual(resolved.schema, {
    tags: ["contacts"],
    summary: "Create contact",
    body: toFastifySchema(bodySchema, "patch")
  });
  assert.equal(typeof resolved.input.body, "function");
  assert.deepEqual(resolved.input.body({
    name: "  Ada  "
  }), {
    name: "Ada"
  });
  assert.deepEqual(resolved.middleware, ["api"]);
});

test("resolveRouteValidatorOptions rejects schema/input definitions", () => {
  assert.throws(
    () => resolveRouteValidatorOptions({
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
    }),
    /uses unsupported validator options: schema, input/
  );
});

test("resolveRouteValidatorOptions rejects validator wrapper", () => {
  assert.throws(
    () => resolveRouteValidatorOptions({
      method: "POST",
      path: "/contacts",
      options: {
        validator: defineRouteValidator({}),
        middleware: ["api"]
      }
    }),
    /uses unsupported validator options: validator/
  );
});

test("defineRouteValidator rejects unsupported advanced.jskitInput", () => {
  assert.throws(
    () =>
      defineRouteValidator({
        advanced: {
          jskitInput: {}
        }
      }),
    /advanced\.jskitInput is not supported/
  );
});

test("defineRouteValidator rejects unsupported top-level keys generically", () => {
  assert.throws(
    () =>
      defineRouteValidator({
        unsupportedContract: {
          schema: {
            type: "object"
          }
        }
      }),
    /defineRouteValidator\(\)\.unsupportedContract is not supported/
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

test("HttpRouter.register rejects validator wrapper options", () => {
  const router = createRouter();
  assert.throws(
    () => router.register(
      "POST",
      "/contacts",
      {
        validator: defineRouteValidator({})
      },
      async () => {}
    ),
    /uses unsupported validator options: validator/
  );
});

test("HttpRouter.register rejects compiled route option payloads", () => {
  const router = createRouter();
  const querySchema = createSchema({
    dryRun: {
      type: "boolean",
      required: false,
      strictBoolean: true
    }
  });

  const validator = defineRouteValidator({
    query: {
      schema: querySchema
    }
  });

  assert.throws(
    () => router.get(
      "/contacts",
      validator.toRouteOptions(),
      async () => {}
    ),
    /uses unsupported validator options: schema, input/
  );
});

test("HttpRouter.register accepts inline validator shape directly", () => {
  const router = createRouter();
  const querySchema = createSchema({
    dryRun: {
      type: "boolean",
      required: false,
      strictBoolean: true
    }
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
      }
    },
    async () => {}
  );

  const [route] = router.list();
  assert.deepEqual(route.schema, {
    tags: ["contacts"],
    summary: "List contacts",
    querystring: toFastifySchema(querySchema, "patch")
  });
  assert.equal(typeof route.input.query, "function");
  assert.deepEqual(route.input.query({
    dryRun: true
  }), {
    dryRun: true
  });
});

test("HttpRouter.register accepts explicit transport metadata and output transform", () => {
  const router = createRouter();
  const output = (payload) => ({
    data: payload
  });
  const error = (currentError) => ({
    errors: [{
      title: currentError.message
    }]
  });

  router.get(
    "/contacts",
    {
      transport: {
        kind: "jsonapi-resource",
        contentType: "application/vnd.api+json",
        request: {
          body(body) {
            return body?.data?.attributes || {};
          }
        },
        error
      },
      output
    },
    async () => {}
  );

  const [route] = router.list();
  assert.equal(route.transport.kind, "jsonapi-resource");
  assert.equal(route.transport.contentType, "application/vnd.api+json");
  assert.equal(typeof route.transport.request.body, "function");
  assert.equal(route.transport.error, error);
  assert.equal(route.output, output);
});

test("HttpRouter.register rejects invalid transport definitions and output transforms", () => {
  const router = createRouter();

  assert.throws(
    () => router.get(
      "/contacts",
      {
        transport: {
          kind: "weird"
        }
      },
      async () => {}
    ),
    /transport\.kind must be one of: command, jsonapi-resource/
  );

  assert.throws(
    () => router.get(
      "/contacts",
      {
        output: {
          mode: "unsupported"
        }
      },
      async () => {}
    ),
    /output must be a function/
  );
});

test("compileRouteValidator strips json-rest transport metadata before Fastify handoff", () => {
  const nestedSchema = createSchema({
    profile: {
      type: "object",
      required: false,
      schema: createSchema({
        email: {
          type: "string",
          required: false,
          minLength: 3,
          format: "email"
        }
      }),
      additionalProperties: true
    }
  });

  const compiled = compileRouteValidator({
    body: {
      schema: nestedSchema
    },
    responses: {
      200: {
        schema: nestedSchema,
        mode: "replace"
      }
    }
  });

  assert.equal(JSON.stringify(compiled.schema).includes("x-json-rest-schema"), false);
  assert.deepEqual(compiled.schema.body, toFastifySchema(nestedSchema, "patch"));
  assert.deepEqual(compiled.schema.response[200], toFastifySchema(nestedSchema, "replace"));
});
