import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Fastify from "fastify";
import SerializerSelector from "@fastify/fast-json-stringify-compiler";
import { createCachedResponseSerializerFactory } from "./responseSerializerFactory.js";

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

test("reuses exact JSON schemas and preserves native rejection without caching failures", () => {
  const native = trackNativeFactory();
  const compile = createCachedResponseSerializerFactory(native.build)({}, {});
  const first = compile({ schema: successSchema, url: "/one", httpStatus: "200" });
  const second = compile({ schema: structuredClone(successSchema), url: "/two", httpStatus: "201" });
  assert.equal(second, first);
  assert.equal(native.contexts[0].calls.length, 1);
  const errors = compile({ schema: errorSchema });
  assert.notEqual(errors, first);
  assert.equal(native.contexts[0].calls.length, 2);

  const schema = { type: "string" };
  const string = compile({ schema });
  schema.type = "integer";
  const integer = compile({ schema });
  assert.notEqual(integer, string);
  assert.equal(string(3), '"3"');
  assert.equal(integer(3), "3");

  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => compile({ schema: { $ref: "missing" } }), /reference|schema/i);
  }
  assert.equal(native.contexts[0].calls.length, 6);
  assert.throws(() => createCachedResponseSerializerFactory(null), /serializer builder/);
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
  assert.equal(cached.contexts[0].calls.length, 2);
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
