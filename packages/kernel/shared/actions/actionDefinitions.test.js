import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { __testables, normalizeActionDefinition } from "./actionDefinitions.js";

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

test("normalizeActionInputDefinition accepts section-map schema syntax", () => {
  const definition = __testables.normalizeActionInputDefinition(
    {
      payload: createPatchSchema()
    },
    "input",
    { required: true }
  );

  assert.equal(typeof definition, "object");
  assert.equal(Array.isArray(definition), false);
  assert.deepEqual(Object.keys(definition), ["payload"]);
  assertJsonRestSchemaDefinition(definition.payload);
});

test("normalizeActionInputDefinition preserves arrays that combine root and section schemas", () => {
  const definition = __testables.normalizeActionInputDefinition(
    [
      createWorkspaceSlugSchema(),
      {
        patch: createPatchSchema()
      }
    ],
    "input",
    { required: true }
  );

  assert.equal(Array.isArray(definition), true);
  assert.equal(definition.length, 2);
  assertJsonRestSchemaDefinition(definition[0]);
  assert.deepEqual(Object.keys(definition[1]), ["patch"]);
  assertJsonRestSchemaDefinition(definition[1].patch);
});

test("normalizeActionInputDefinition rejects invalid section-map entries", () => {
  assert.throws(
    () =>
      __testables.normalizeActionInputDefinition(
        {
          payload: {
            schema: null
          }
        },
        "input",
        { required: true }
      ),
    /input\.payload\.schema must be a function or object/
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

test("normalizeActionDefinition stays channel-agnostic and ignores unknown legacy fields", () => {
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
    idempotency: "none",
    assistantTool: {
      description: "Legacy field"
    },
    execute: async () => ({})
  });

  assert.equal(typeof definition, "object");
  assert.equal(Object.prototype.hasOwnProperty.call(definition, "assistantTool"), false);
});

test("normalizeActionOutputDefinition accepts section-map syntax", () => {
  const output = __testables.normalizeActionOutputDefinition(
    {
      payload: createPatchSchema()
    },
    "output",
    { required: false }
  );

  assert.equal(typeof output, "object");
  assert.deepEqual(Object.keys(output), ["payload"]);
  assertJsonRestSchemaDefinition(output.payload);
});

test("normalizeActionOutputDefinition accepts single schema definitions", () => {
  const output = __testables.normalizeActionOutputDefinition(
    {
      schema: createSchema({
        ok: {
          type: "boolean",
          required: true
        }
      })
    },
    "output",
    { required: false }
  );

  assertJsonRestSchemaDefinition(output);
});

test("normalizeActionInputDefinition preserves mode for json-rest-schema definitions", () => {
  const definition = __testables.normalizeActionInputDefinition(
    {
      schema: createMockJsonRestSchema(),
      mode: "patch"
    },
    "input",
    { required: true }
  );

  assert.equal(definition.mode, "patch");
});
