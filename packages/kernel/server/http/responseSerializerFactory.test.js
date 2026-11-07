import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import { deepFreeze } from "../../shared/support/deepFreeze.js";
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
  const calls = () => native.contexts[0].calls.length;
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
  assert.equal(native.contexts.length, 4);
  assert.ok(native.contexts.every(({ calls }) => calls.length === 1));
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
  assert.equal(cached.contexts[0].calls.length, 2);
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
