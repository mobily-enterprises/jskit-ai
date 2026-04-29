import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { __testables, normalizeActionDefinition } from "./actionDefinitions.js";

function createMockJsonRestSchema() {
  return {
    async create(payload = {}) {
      return {
        validatedObject: payload,
        errors: {}
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
        type: "object"
      };
    }
  };
}

function createWorkspaceSlugSchema() {
  return {
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  };
}

function createPatchSchema() {
  return {
    schema: Type.Object(
      {
        name: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
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
  assert.equal(definition.payload?.schema?.type, "object");
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
  assert.equal(definition[0]?.schema?.type, "object");
  assert.deepEqual(Object.keys(definition[1]), ["patch"]);
  assert.equal(definition[1].patch?.schema?.type, "object");
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
      schema: Type.Object({}, { additionalProperties: false })
    },
    output: {
      schema: Type.Object({}, { additionalProperties: false })
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
  assert.equal(output.payload?.schema?.type, "object");
});

test("normalizeActionOutputDefinition accepts single schema definitions", () => {
  const output = __testables.normalizeActionOutputDefinition(
    {
      schema: Type.Object(
        {
          ok: Type.Boolean()
        },
        { additionalProperties: false }
      )
    },
    "output",
    { required: false }
  );

  assert.equal(output?.schema?.type, "object");
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
