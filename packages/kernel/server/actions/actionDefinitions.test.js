import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { __testables, normalizeActionDefinition, toRegisteredContributor } from "./actionDefinitions.js";
import { noActionPolicy } from "./actionPolicy.js";

function assertJsonRestSchemaDefinition(definition) {
  assert.equal(typeof definition?.schema?.patch, "function");
  assert.equal(typeof definition?.schema?.replace, "function");
  assert.equal(typeof definition?.schema?.toJsonSchema, "function");
}

function createMockJsonRestSchema() {
  return {
    create(payload = {}) {
      return {
        validatedObject: payload,
        errors: {}
      };
    },
    replace(payload = {}) {
      return this.create(payload);
    },
    patch(payload = {}) {
      return this.create(payload);
    },
    toJsonSchema() {
      return {
        type: "object"
      };
    }
  };
}

function createWorkspaceSlugSchema() {
  return {
    schema: createSchema({
      workspaceSlug: {
        type: "string",
        minLength: 1
      }
    }),
    mode: "patch"
  };
}

function createPatchSchema() {
  return {
    schema: createSchema({
      name: {
        type: "string",
        minLength: 1
      }
    }),
    mode: "patch"
  };
}

test("normalizeActionSchema accepts a single schema definition", () => {
  const definition = __testables.normalizeActionSchema(
    createPatchSchema(),
    "input",
    { required: true, defaultMode: "patch" }
  );

  assertJsonRestSchemaDefinition(definition);
});

test("normalizeActionSchema rejects section-map syntax", () => {
  assert.throws(
    () =>
      __testables.normalizeActionSchema(
        {
          payload: createPatchSchema()
        },
        "input",
        { required: true, defaultMode: "patch" }
      ),
    /Action definition input must be a schema definition object/
  );
});

test("normalizeActionSchema rejects bare schema instances", () => {
  assert.throws(
    () =>
      __testables.normalizeActionSchema(
        createSchema({
          name: {
            type: "string",
            minLength: 1
          }
        }),
        "input",
        { required: true, defaultMode: "patch" }
      ),
    /Action definition input must be a schema definition object/
  );
});

test("normalizeActionSchema rejects validator arrays", () => {
  assert.throws(
    () =>
      __testables.normalizeActionSchema(
        [
          createWorkspaceSlugSchema(),
          createPatchSchema()
        ],
        "input",
        { required: true, defaultMode: "patch" }
      ),
    /input must be a single schema definition/
  );
});

test("normalizeActionExtensions keeps plain objects", () => {
  const extensions = __testables.normalizeActionExtensions({
    assistant: {
      description: "Update workspace settings."
    }
  });

  assert.equal(typeof extensions, "object");
  assert.equal(extensions.assistant?.description, "Update workspace settings.");
});

test("normalizeActionDefinition stays channel-agnostic and ignores unknown extra fields", () => {
  const definition = normalizeActionDefinition({
    id: "demo.workspace.settings.update",
    domain: "demo",
    version: 1,
    kind: "command",
    channels: ["automation"],
    surfaces: ["admin"],
    input: {
      schema: createSchema({})
    },
    output: {
      schema: createSchema({})
    },
    customExtension: {
      description: "Ignored field"
    },
    execute: async () => ({})
  });

  assert.equal(typeof definition, "object");
  assert.equal(Object.prototype.hasOwnProperty.call(definition, "customExtension"), false);
});

test("normalizeActionDefinition refuses a definition that declares idempotency", () => {
  assert.throws(
    () => normalizeActionDefinition({
      id: "demo.notes.create",
      domain: "demo",
      channels: ["api"],
      surfaces: ["app"],
      input: { schema: createSchema({}) },
      idempotency: "optional",
      execute: async () => ({})
    }),
    {
      message: "Action definition \"demo.notes.create\" declares idempotency. Action definitions no longer declare idempotency."
    }
  );
});

test("normalizeActionSchema accepts single schema definitions", () => {
  const output = __testables.normalizeActionSchema(
    {
      schema: createSchema({
        ok: {
          type: "boolean",
          required: true
        }
      })
    },
    "output",
    { defaultMode: "replace" }
  );

  assertJsonRestSchemaDefinition(output);
});

test("normalizeActionSchema rejects section-map syntax", () => {
  assert.throws(
    () =>
      __testables.normalizeActionSchema(
        {
          payload: createPatchSchema()
        },
        "output",
        { defaultMode: "replace" }
      ),
    /Action definition output must be a schema definition object/
  );
});

test("normalizeActionSchema preserves mode for json-rest-schema definitions", () => {
  const definition = __testables.normalizeActionSchema(
    {
      schema: createMockJsonRestSchema(),
      mode: "patch"
    },
    "input",
    { required: true, defaultMode: "patch" }
  );

  assert.equal(definition.mode, "patch");
});

test("normalizeActionSchema rejects a missing required schema and allows a missing optional one", () => {
  assert.equal(__testables.normalizeActionSchema(null, "output"), null);
  assert.throws(
    () => __testables.normalizeActionSchema(undefined, "input", { required: true }),
    /Action definition input is required/
  );
});

test("normalizeActionDefinition keeps only the contract the runtime enforces", () => {
  const definition = normalizeActionDefinition({
    id: "demo.status.read",
    domain: "demo",
    channels: ["api"],
    surfaces: ["app"],
    input: { schema: createSchema({}) },
    audit: { actionName: "demo.status.read" },
    observability: {},
    execute: async () => ({})
  });

  assert.equal(Object.hasOwn(definition, "audit"), false);
  assert.equal(Object.hasOwn(definition, "observability"), false);
  assert.deepEqual(Object.keys(definition).sort(), [
    "channels",
    "contributorId",
    "domain",
    "events",
    "execute",
    "extensions",
    "id",
    "input",
    "kind",
    "output",
    "permission",
    "surfaces",
    "version"
  ]);
});

test("normalizeActionDefinition validates domains with the architecture id pattern", () => {
  const base = {
    id: "demo.status.read",
    channels: ["api"],
    surfaces: ["app"],
    input: { schema: createSchema({}) },
    execute: async () => ({})
  };
  assert.equal(normalizeActionDefinition({ ...base, domain: " Demo.Status " }).domain, "demo.status");
  assert.throws(() => normalizeActionDefinition({ ...base, domain: "1demo" }), {
    message: /domain must match/
  });
});

test("normalizeActionDefinition refuses oneOf on an input field and names enum", () => {
  const base = {
    id: "demo.notes.list",
    domain: "demo",
    channels: ["api"],
    surfaces: ["app"],
    execute: async () => ({})
  };

  assert.throws(
    () => normalizeActionDefinition({
      ...base,
      input: { schema: createSchema({ status: { type: "string", oneOf: ["open", "closed"] } }) }
    }),
    {
      message: "Action definition input field \"status\" declares oneOf, which does not restrict its value; " +
        "list the allowed values with enum."
    }
  );

  const declared = { ...base, input: { schema: createSchema({ status: { type: "string", enum: ["open", "closed"] } }) } };
  const definition = normalizeActionDefinition(declared);
  assert.equal(definition.input.schema.create({ status: "other" }).errors.status?.code, "ENUM_VALUE");

  // A policy's input is checked like a declared one.
  const contributor = { contributorId: "demo.notes", domain: "demo", actions: [declared] };
  const scopedPolicy = {
    ...noActionPolicy,
    input: () => ({ schema: createSchema({ scope: { type: "string", oneOf: ["mine"] } }) })
  };
  assert.throws(() => toRegisteredContributor(contributor, scopedPolicy), { message: /input field "scope" declares oneOf/ });
});

test("normalizeActionSchema refuses oneOf on nested input fields and leaves output alone", () => {
  const refuse = { required: true, defaultMode: "create", refuseOneOf: true };

  assert.throws(
    () => __testables.normalizeActionSchema({
      schema: createSchema({
        filter: { type: "object", schema: createSchema({ status: { type: "string", oneOf: ["open"] } }) }
      })
    }, "input", refuse),
    { message: /input field "filter\.status" declares oneOf.*with enum\.$/ }
  );
  assert.throws(
    () => __testables.normalizeActionSchema({
      schema: createSchema({
        tags: { type: "array", items: { type: "string", oneOf: ["a"] } }
      })
    }, "input", refuse),
    { message: /input field "tags\[\]" declares oneOf/ }
  );
  assert.throws(
    () => __testables.normalizeActionSchema({
      schema: createSchema({
        lines: { type: "array", items: createSchema({ status: { type: "string", oneOf: ["open"] } }) }
      })
    }, "input", refuse),
    { message: /input field "lines\[\]\.status" declares oneOf/ }
  );
  assert.throws(
    () => __testables.normalizeActionSchema({
      schema: createSchema({
        labels: { type: "object", values: { type: "string", oneOf: ["red"] } }
      })
    }, "input", refuse),
    { message: /input field "labels\.\*" declares oneOf/ }
  );

  const searchLike = { schema: createSchema({ q: { type: "string", oneOf: ["title", "author"] } }) };
  assert.equal(__testables.normalizeActionSchema(searchLike, "output", { defaultMode: "replace" }).schema, searchLike.schema);
  assert.equal(
    __testables.normalizeActionSchema({ schema: createMockJsonRestSchema() }, "input", refuse).mode,
    "create"
  );
});
