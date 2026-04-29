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

test("normalizeActionInputDefinition accepts a single schema definition", () => {
  const definition = __testables.normalizeActionInputDefinition(
    createPatchSchema(),
    "input",
    { required: true }
  );

  assertJsonRestSchemaDefinition(definition);
});

test("normalizeActionInputDefinition rejects section-map syntax", () => {
  assert.throws(
    () =>
      __testables.normalizeActionInputDefinition(
        {
          payload: createPatchSchema()
        },
        "input",
        { required: true }
      ),
    /Action definition input must be a schema definition object/
  );
});

test("normalizeActionInputDefinition rejects bare schema instances", () => {
  assert.throws(
    () =>
      __testables.normalizeActionInputDefinition(
        createSchema({
          name: {
            type: "string",
            minLength: 1
          }
        }),
        "input",
        { required: true }
      ),
    /Action definition input must be a schema definition object/
  );
});

test("normalizeActionInputDefinition rejects validator arrays", () => {
  assert.throws(
    () =>
      __testables.normalizeActionInputDefinition(
        [
          createWorkspaceSlugSchema(),
          createPatchSchema()
        ],
        "input",
        { required: true }
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

test("normalizeActionOutputDefinition rejects section-map syntax", () => {
  assert.throws(
    () =>
      __testables.normalizeActionOutputDefinition(
        {
          payload: createPatchSchema()
        },
        "output",
        { required: false }
      ),
    /Action definition output must be a schema definition object/
  );
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
