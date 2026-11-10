import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import fastJsonStringify from "fast-json-stringify";
import { createSchema } from "json-rest-schema";
import { deepFreeze } from "../../shared/support/deepFreeze.js";
import { resolveSchemaTransportSchemaDefinition } from "../../shared/validators/index.js";
import { createCachedResponseSerializerFactory, schemaCacheKey } from "./responseSerializerFactory.js";

const linkSchema = {
  anyOf: [{ type: "string", minLength: 1 }, { type: "object", additionalProperties: true }]
};
const linksSchema = { type: "object", additionalProperties: linkSchema };
const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["errors"],
  properties: {
    errors: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string" },
          detail: { type: "string" },
          links: linksSchema,
          meta: { type: "object", additionalProperties: true }
        }
      }
    },
    links: linksSchema
  }
};
const successSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "id"],
          properties: {
            type: { const: "records" },
            id: { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
            attributes: {
              type: "object",
              additionalProperties: false,
              properties: { title: { type: "string" } }
            },
            links: linksSchema
          }
        },
        { type: "null" }
      ]
    },
    links: linksSchema
  }
};

function trackNativeFactory() {
  const build = SerializerSelector();
  const contexts = [];
  return {
    contexts,
    build(externalSchemas, options) {
      const compile = build(externalSchemas, options);
      const calls = [];
      contexts.push({ externalSchemas, options, calls });
      return (input) => {
        calls.push(input);
        return compile(input);
      };
    }
  };
}

test("reuses exact JSON schemas, compiles each on first use and preserves native rejection without caching failures", () => {
  const native = trackNativeFactory();
  const compile = createCachedResponseSerializerFactory(native.build)({}, {});
  const calls = () => native.contexts.reduce((sum, context) => sum + context.calls.length, 0);
  const first = compile({ schema: successSchema, url: "/one", httpStatus: "200" });
  const second = compile({ schema: structuredClone(successSchema), url: "/two", httpStatus: "201" });
  assert.equal(second, first);
  const errors = compile({ schema: errorSchema });
  assert.notEqual(errors, first);
  assert.equal(calls(), 0);
  assert.equal(first({ data: null }), '{"data":null}');
  assert.equal(second({ data: null, extra: 1 }), '{"data":null}');
  assert.equal(calls(), 1);

  // A schema changed after registration still serializes as it was registered.
  const schema = { type: "string" };
  const string = compile({ schema });
  schema.type = "integer";
  const integer = compile({ schema });
  assert.notEqual(integer, string);
  assert.equal(string(3), '"3"');
  assert.equal(integer(3), "3");
  assert.equal(calls(), 3);

  // An invalid schema fails at registration, before anything is built; an unresolvable reference is built at once
  // and fails with the build's own error. Neither failure is cached.
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => compile({ schema: { type: "strin" } }), /schema is invalid: data\/type/);
    assert.throws(() => compile({ schema: { $ref: "missing" } }), /reference|schema/i);
    assert.throws(() => compile({ schema: { type: "object", properties: { id: { $ref: "#/definitions/id" } } } }),
      /Cannot find reference/);
  }
  assert.equal(calls(), 7);
  assert.throws(() => createCachedResponseSerializerFactory(null), /serializer builder/);
});

test("a schema frozen all the way down is checked once however many routes compile it, a changeable one every time", (t) => {
  const native = trackNativeFactory();
  const compile = createCachedResponseSerializerFactory(native.build)({}, {});
  const frozen = deepFreeze(structuredClone(errorSchema));
  const changeable = structuredClone(errorSchema);
  const ownKeys = t.mock.method(Reflect, "ownKeys");

  const first = compile({ schema: frozen, url: "/route-0", httpStatus: "404" });
  const checked = ownKeys.mock.callCount();
  assert.ok(checked > 0);
  for (let route = 1; route <= 50; route++) {
    assert.equal(compile({ schema: frozen, url: `/route-${route}`, httpStatus: "404" }), first);
  }
  assert.equal(ownKeys.mock.callCount(), checked);

  assert.equal(compile({ schema: changeable }), first);
  const afterFirstChangeable = ownKeys.mock.callCount();
  assert.equal(compile({ schema: changeable }), first);
  assert.ok(ownKeys.mock.callCount() > afterFirstChangeable);
  assert.equal(first({ errors: [{ status: "404", extra: 1 }] }), '{"errors":[{"status":"404"}]}');
  // A schema that is not an object has nothing to remember it by and is keyed as before.
  assert.equal(schemaCacheKey(true), "true");
});

test("a serializer whose first build fails builds again at its next use", () => {
  let builds = 0;
  const compile = createCachedResponseSerializerFactory(() => () => {
    builds += 1;
    if (builds === 1) throw new Error("The first build fails.");
    return (data) => `built ${data}`;
  })({}, {});
  const serialize = compile({ schema: { type: "string" } });
  assert.equal(builds, 0);
  assert.throws(() => serialize("a"), /first build fails/);
  assert.equal(serialize("b"), "built b");
  assert.equal(serialize("c"), "built c");
  assert.equal(builds, 2);
});

test("routes compile no response serializer at startup and one per schema their responses use", async (t) => {
  const native = trackNativeFactory();
  const app = Fastify({
    schemaController: { compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(native.build) } }
  });
  t.after(() => app.close());
  const routes = 40;
  for (let index = 0; index < routes; index++) {
    app.get(`/records/${index}`, {
      schema: {
        response: {
          200: { ...structuredClone(successSchema), title: `Record ${index}` },
          400: { ...structuredClone(errorSchema), title: `Record ${index} error` }
        }
      }
    }, async () => ({ data: { type: "records", id: index, attributes: { title: "One" } } }));
  }
  await app.ready();
  const compiled = () => native.contexts.reduce((sum, { calls }) => sum + calls.length, 0);
  assert.equal(compiled(), 0);
  for (let request = 0; request < 3; request++) {
    assert.equal((await app.inject("/records/7")).body, '{"data":{"type":"records","id":7,"attributes":{"title":"One"}}}');
  }
  assert.equal(compiled(), 1);
});

test("an invalid or unresolvable response schema still stops startup", async () => {
  const cases = [
    [{ type: "object", properties: { title: { type: "strin" } } }, /schema is invalid: data\/properties\/title\/type/],
    [{ type: "object", properties: { id: { $ref: "#/definitions/id" } } }, /Cannot find reference/],
    [{ type: "object", properties: { id: { $ref: "shared#/properties/id" } } }, /Cannot resolve ref|not found/]
  ];
  for (const [schema, message] of cases) {
    const app = Fastify({
      schemaController: {
        compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(SerializerSelector()) }
      }
    });
    app.get("/broken", { schema: { response: { 200: schema } } }, async () => ({}));
    await assert.rejects(app.ready(), (error) => {
      assert.match(error.message, /serialization schema/);
      assert.match(error.message, message);
      return true;
    });
    await app.close();
  }
});

test("non-JSON schema inputs delegate unchanged without lossy cache keys or getter calls", () => {
  const calls = [];
  const compile = createCachedResponseSerializerFactory(() => (options) => {
    calls.push(options);
    return () => "custom";
  })({}, {});
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "type", {
    enumerable: true,
    get() { getterCalls++; return "string"; }
  });
  const hidden = Object.defineProperty({}, "type", { value: "integer" });
  const cycle = {};
  cycle.self = cycle;
  const namedArray = [1];
  namedArray.extra = true;
  const schemas = [
    { default: undefined }, { default: NaN }, { default: Infinity }, { default: 1n },
    { default: new Date(0) }, { pattern: /example/ }, { keyword() {} },
    { [Symbol("custom")]: true }, accessor, hidden, cycle,
    { default: new Array(2) }, { default: namedArray },
    Object.create({ type: "string" }),
    { toJSON() { throw new Error("must not execute toJSON"); } }
  ];
  for (const schema of schemas) {
    const options = { schema, method: "GET", url: "/custom" };
    assert.notEqual(compile(options), compile(options));
    assert.equal(calls.at(-1), options);
  }
  assert.equal(calls.length, schemas.length * 2);
  assert.equal(getterCalls, 0);
});

test("each factory invocation isolates serializer options and external references", () => {
  const native = trackNativeFactory();
  const build = createCachedResponseSerializerFactory(native.build);
  const schema = { $ref: "value" };
  const integers = { value: { $id: "value", type: "integer" } };
  const strings = { value: { $id: "value", type: "string" } };
  const floor = build(integers, { rounding: "floor" })({ schema });
  const ceil = build(integers, { rounding: "ceil" })({ schema });
  const string = build(strings, {})({ schema });
  const another = build(strings, {})({ schema });
  assert.equal(floor(3.8), "3");
  assert.equal(ceil(3.8), "4");
  assert.equal(string(3.8), '"3.8"');
  assert.notEqual(another, string);
  assert.equal(another(1), '"1"');
  // Each invocation builds its serializers in fast-json-stringify's debug mode, for restore, with its own options.
  const debug = native.contexts.filter(({ options }) => options.mode === "debug");
  assert.equal(debug.length, 4);
  assert.deepEqual(debug.map(({ options }) => options.rounding), ["floor", "ceil", undefined, undefined]);
  assert.ok(debug.every(({ calls }) => calls.length === 1));
  assert.ok(native.contexts.every(({ options, calls }) => options.mode === "debug" || calls.length === 0));
});

test("Fastify startup reuses serializers with identical native HTTP output and errors", async (t) => {
  const native = trackNativeFactory();
  const cached = trackNativeFactory();
  const applications = [native.build, createCachedResponseSerializerFactory(cached.build)]
    .map((buildSerializer) => Fastify({ schemaController: { compilersFactory: { buildSerializer } } }));
  let payload;
  let status;
  for (const app of applications) {
    t.after(() => app.close());
    for (const url of ["/one", "/two"]) {
      app.get(url, {
        schema: {
          response: {
            200: structuredClone(successSchema),
            201: { content: { "application/vnd.api+json": { schema: structuredClone(successSchema) } } },
            400: structuredClone(errorSchema),
            403: structuredClone(errorSchema)
          }
        }
      }, async (_request, reply) => reply.code(status).type("application/vnd.api+json").send(payload));
    }
    await app.ready();
  }
  assert.equal(cached.contexts.length, 1);
  assert.equal(cached.contexts[0].calls.length, 0);
  assert.ok(native.contexts[0].calls.length > 2);

  const cases = [
    [200, { data: { type: "records", id: 1, attributes: { title: "One", ignored: true } }, ignored: true }],
    [201, { data: { type: "records", id: "two", links: { self: "/two", related: { href: "/three" } } } }],
    [200, { data: null }],
    [200, {}],
    [200, { data: { type: "records" } }],
    [200, { data: { type: "records", id: "" } }],
    [400, { errors: [{ status: "400", detail: "Invalid", ignored: true, meta: { field: "title" } }] }],
    [403, { errors: [{ status: "403", links: { help: "/help" } }] }],
    ...["", null, ["/invalid"]].flatMap((link) => [
      [200, { data: { type: "records", id: "one" }, links: { self: link } }],
      [400, { errors: [{ status: "400", links: { self: link } }] }]
    ])
  ];
  for ([status, payload] of cases) {
    const original = await applications[0].inject("/one");
    const reused = await applications[1].inject("/two");
    assert.equal(reused.statusCode, original.statusCode);
    assert.equal(reused.headers["content-type"], original.headers["content-type"]);
    assert.equal(reused.body, original.body);
  }
  for (const link of ["", null, ["/invalid"]]) {
    status = 400;
    payload = { errors: [{ links: { self: link } }] };
    assert.equal((await applications[1].inject("/two")).statusCode, 500);
  }
  assert.equal(cached.contexts.reduce((sum, { calls }) => sum + calls.length, 0), 2);
});

test("Fastify encapsulation and schema additions create isolated compiler contexts", async (t) => {
  const native = trackNativeFactory();
  const app = Fastify({
    schemaController: { compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(native.build) } }
  });
  t.after(() => app.close());
  app.register(async (strings) => {
    strings.addSchema({ $id: "value", type: "string" });
    strings.get("/string", { schema: { response: { 200: { $ref: "value" } } } }, async () => 12);
    strings.register(async (nested) => {
      nested.addSchema({ $id: "extra", type: "boolean" });
      nested.get("/nested", { schema: { response: { 200: { $ref: "value" } } } }, async () => 13);
      nested.get("/added", { schema: { response: { 200: { $ref: "extra" } } } }, async () => true);
    });
  });
  app.register(async (integers) => {
    integers.addSchema({ $id: "value", type: "integer" });
    integers.get("/integer", { schema: { response: { 200: { $ref: "value" } } } }, async () => 12);
  });
  await app.ready();
  assert.equal((await app.inject("/string")).body, '"12"');
  assert.equal((await app.inject("/nested")).body, '"13"');
  assert.equal((await app.inject("/added")).body, "true");
  assert.equal((await app.inject("/integer")).body, "12");
  assert.deepEqual(new Set(native.contexts.map(({ externalSchemas }) =>
    `${externalSchemas.value.type}:${Object.keys(externalSchemas).sort().join(",")}`
  )), new Set(["string:value", "string:extra,value", "integer:value"]));
});

test("Fastify application and route serializer overrides remain authoritative", async (t) => {
  const native = trackNativeFactory();
  const options = {
    schemaController: { compilersFactory: { buildSerializer: createCachedResponseSerializerFactory(native.build) } }
  };
  const app = Fastify(options);
  t.after(() => app.close());
  const inputs = [];
  app.setSerializerCompiler((input) => {
    inputs.push(input);
    return () => JSON.stringify({ owner: "application", url: input.url });
  });
  app.get("/app", { schema: { response: { 200: { type: "object" } } } }, async () => ({}));
  app.get("/route", {
    schema: { response: { 200: { type: "object" } } },
    serializerCompiler: (input) => () => JSON.stringify({ owner: "route", url: input.url })
  }, async () => ({}));
  await app.ready();
  assert.deepEqual((await app.inject("/app")).json(), { owner: "application", url: "/app" });
  assert.deepEqual((await app.inject("/route")).json(), { owner: "route", url: "/route" });
  assert.equal(native.contexts.length, 0);
  assert.ok(inputs.every(({ url, schema }) => url === "/app" && schema.type === "object"));
});

test("native duplicate schema-id failures are unchanged", (t) => {
  for (const buildSerializer of [SerializerSelector(), createCachedResponseSerializerFactory(SerializerSelector())]) {
    const app = Fastify({ schemaController: { compilersFactory: { buildSerializer } } });
    t.after(() => app.close());
    app.addSchema({ $id: "duplicate", type: "string" });
    assert.throws(() => app.addSchema({ $id: "duplicate", type: "integer" }), { code: "FST_ERR_SCH_ALREADY_PRESENT" });
  }
});

test("generic and HTTP kernel imports do not load Fastify or response-compiler dependencies", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@fastify/") || ["fastify", "fast-json-stringify", "ajv"].includes(specifier.split("/")[0])) {
        throw new Error("Unexpected framework import: " + specifier);
      }
      return nextResolve(specifier, context);
    } });
    await import(${JSON.stringify(new URL("../platform/index.js", import.meta.url).href)});
    await import(${JSON.stringify(new URL("./index.js", import.meta.url).href)});
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

// Attributes exported by json-rest-schema, with a JSON:API nullable relationship as the HTTP runtime writes it: nullable
// numbers, booleans with enums, dates and relationships are each a union.
function recordAttributes(fieldsPerKind = 1) {
  const structure = { active: { type: "boolean", required: true } };
  for (let index = 0; index < fieldsPerKind; index++) {
    Object.assign(structure, {
      [`amount${index}`]: { type: "number", nullable: true },
      [`count${index}`]: { type: "integer", nullable: true, min: 0 },
      [`flagged${index}`]: { type: "boolean", nullable: true },
      [`startsAt${index}`]: { type: "dateTime", nullable: true },
      [`day${index}`]: { type: "date", nullable: true },
      [`title${index}`]: { type: "string", nullable: true, maxLength: 20 }
    });
  }
  const { $schema: _draft, ...attributes } = resolveSchemaTransportSchemaDefinition(
    { schema: createSchema(structure), mode: "replace" },
    { defaultMode: "replace" }
  );
  return attributes;
}

function nullableRelationship(type) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
      data: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "id"],
            properties: { type: { const: type }, id: { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] } }
          },
          { type: "null" }
        ]
      }
    }
  };
}

function recordListSchema({ fieldsPerKind = 1, relationships = 1 } = {}) {
  const relationshipProperties = {};
  for (let index = 0; index < relationships; index++) {
    relationshipProperties[`owner${index}`] = nullableRelationship(`owners${index % 3}`);
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
      data: {
        type: "array",
        items: { allOf: [{ $ref: "#/definitions/record" }] }
      },
      links: linksSchema
    },
    definitions: {
      record: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id", "attributes"],
        properties: {
          type: { const: "records" },
          id: { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
          attributes: { allOf: [{ $ref: "#/definitions/attributes" }] },
          relationships: { type: "object", additionalProperties: false, properties: relationshipProperties }
        }
      },
      attributes: recordAttributes(fieldsPerKind)
    }
  };
}

// What a serializer writes for the value, or the error it refuses it with. fast-json-stringify numbers the schemas it
// makes inside a build with one counter for the process, so two builds of a schema, native ones too, differ only there.
function outcome(serialize, value) {
  try {
    return { json: serialize(value) };
  } catch (error) {
    return { error: error.constructor.name, message: error.message.replace(/__fjs_(root|merged)_\d+/g, "__fjs_$1_<n>") };
  }
}

test("union branches compiled on their own write and refuse every value exactly as before, with the same errors", () => {
  const schema = recordListSchema();
  const native = fastJsonStringify(structuredClone(schema));
  const compile = createCachedResponseSerializerFactory(SerializerSelector())({}, {});
  const lifted = compile({ schema: structuredClone(schema), httpStatus: "200" });
  const document = (attributes, relationship = null) => ({
    data: [{ type: "records", id: "1", attributes: { active: true, ...attributes }, relationships: { owner0: { data: relationship } } }]
  });
  const values = [
    null, 0, 1, 1.5, -3, 2 ** 53, NaN, Infinity, -Infinity, "", "12", "1.5", "abc", "yes", "true", "0", true, false,
    new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), "2026-01-02", "2026-01-02T03:04:05.000Z", /pattern/, [], [1], {},
    { toJSON: () => "json" }, { toString: () => "text" }, 10n, "a title that is longer than twenty"
  ];
  const fields = ["active", "amount0", "count0", "flagged0", "startsAt0", "day0", "title0"];
  let refused = 0;
  for (const field of fields) {
    for (const value of values) {
      const expected = outcome(native, document({ [field]: value }));
      assert.deepEqual(outcome(lifted, document({ [field]: value })), expected, `${field}: ${String(value)}`);
      if (expected.error) refused += 1;
    }
  }
  const relationships = [
    null, { type: "owners0", id: "5" }, { type: "owners0", id: 5 }, { type: "others", id: "5" }, { type: "owners0" },
    { type: "owners0", id: "" }, { type: "owners0", id: "5", extra: true }, { type: "owners0", id: null }, [], "5",
    [{ type: "owners0", id: "5" }], { type: "owners0", id: new Date(0) }
  ];
  for (const relationship of relationships) {
    const expected = outcome(native, document({}, relationship));
    assert.deepEqual(outcome(lifted, document({}, relationship)), expected, JSON.stringify(relationship));
    if (expected.error) refused += 1;
  }
  for (const id of [1, "7", "", null, true, [1]]) {
    const value = { data: [{ type: "records", id, attributes: { active: 1 } }], links: { self: id } };
    assert.deepEqual(outcome(lifted, value), outcome(native, value), `id ${JSON.stringify(id)}`);
  }
  assert.ok(refused > 20, `${refused} refused values`);
});

test("a big list compiles each distinct union branch once and never the whole response schema", () => {
  const schema = recordListSchema({ fieldsPerKind: 25, relationships: 30 });
  const built = [];
  const serialize = createCachedResponseSerializerFactory((externalSchemas, options) => {
    const compile = SerializerSelector()(externalSchemas, options);
    return (input) => {
      const result = compile(input);
      built.push(result);
      return result;
    };
  })({}, {})({ schema });
  const rows = Array.from({ length: 20 }, (_, row) => {
    const attributes = { active: row % 2 === 0 };
    for (let index = 0; index < 25; index++) {
      Object.assign(attributes, {
        [`amount${index}`]: row % 3 ? row + index / 4 : null,
        [`count${index}`]: row % 4 ? row : null,
        [`flagged${index}`]: row % 5 ? row % 2 === 1 : null,
        [`startsAt${index}`]: row % 3 ? new Date(Date.UTC(2026, 0, row + 1)) : null,
        [`day${index}`]: row % 2 ? "2026-01-02" : null,
        [`title${index}`]: row % 2 ? `title ${row}` : null
      });
    }
    const relationships = {};
    for (let index = 0; index < 30; index++) {
      relationships[`owner${index}`] = { data: (row + index) % 4 ? { type: `owners${index % 3}`, id: String(row) } : null };
    }
    return { type: "records", id: String(row + 1), attributes, relationships };
  });
  const document = { data: rows, links: { self: "/records", next: { href: "/records?page=2" } } };

  assert.ok(JSON.stringify(schema).match(/"anyOf"/g).length > 200);
  assert.equal(serialize(document), fastJsonStringify(structuredClone(schema))(document));
  const [{ ajv }] = built;
  const schemas = Object.entries(ajv.schemas).filter(([id]) => id.startsWith("__fjs_"));
  assert.ok(schemas.length > 0);
  // Ajv holds the schemas the branches sit in but compiled none of them, only each distinct branch on its own.
  assert.deepEqual(schemas.filter(([, environment]) => environment.validate).map(([id]) => id), []);
});

test("a branch that names another schema, or sits under an escaped name, is validated as before", () => {
  const schema = {
    type: "object",
    properties: {
      record: { anyOf: [{ type: "null" }, { allOf: [{ $ref: "#/definitions/record" }] }] },
      "a/b": { anyOf: [{ type: "integer" }, { type: "null" }] },
      "c~d": { anyOf: [{ type: "integer" }, { type: "null" }] }
    },
    definitions: {
      record: { type: "object", required: ["id"], properties: { id: { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] } } }
    }
  };
  const native = fastJsonStringify(structuredClone(schema));
  const serialize = createCachedResponseSerializerFactory(SerializerSelector())({}, {})({ schema });
  const values = [
    { record: null }, { record: { id: 1 } }, { record: { id: "" } }, { record: {} }, { record: "one" },
    { "a/b": 1 }, { "a/b": null }, { "c~d": 2 }, { "c~d": "two" }
  ];
  for (const value of values) {
    assert.deepEqual(outcome(serialize, value), outcome(native, value), JSON.stringify(value));
  }
});
