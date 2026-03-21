import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { __testables, normalizeActionDefinition } from "./actionDefinitions.js";

function createWorkspaceSlugValidator() {
  return {
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    ),
    normalize(input = {}) {
      const source = input && typeof input === "object" ? input : {};
      if (!Object.hasOwn(source, "workspaceSlug")) {
        return {};
      }

      return {
        workspaceSlug: String(source.workspaceSlug || "").trim().toLowerCase()
      };
    }
  };
}

function createPatchValidator() {
  return {
    schema: Type.Object(
      {
        name: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    ),
    normalize(input = {}) {
      const source = input && typeof input === "object" ? input : {};
      if (!Object.hasOwn(source, "name")) {
        return {};
      }

      return {
        name: String(source.name || "").trim().toLowerCase()
      };
    }
  };
}

test("normalizeActionValidators accepts section-map validator syntax", async () => {
  const validator = __testables.normalizeActionValidators(
    {
      payload: createPatchValidator()
    },
    "inputValidator",
    { required: true }
  );

  assert.equal(typeof validator?.normalize, "function");
  assert.equal(validator?.schema?.type, "object");
  assert.ok(Object.hasOwn(validator.schema?.properties || {}, "payload"));

  const normalized = await validator.normalize({
    payload: {
      name: "  Acme  "
    }
  });

  assert.deepEqual(normalized, {
    payload: {
      name: "acme"
    }
  });
});

test("normalizeActionValidators composes root validators with section-map validators", async () => {
  const validator = __testables.normalizeActionValidators(
    [
      createWorkspaceSlugValidator(),
      {
        patch: createPatchValidator()
      }
    ],
    "inputValidator",
    { required: true }
  );

  const properties = Object.keys(validator.schema?.properties || {}).sort();
  assert.deepEqual(properties, ["patch", "workspaceSlug"]);

  const normalized = await validator.normalize({
    workspaceSlug: "  TEAM-ALPHA  ",
    patch: {
      name: "  Project X  "
    }
  });

  assert.deepEqual(normalized, {
    workspaceSlug: "team-alpha",
    patch: {
      name: "project x"
    }
  });
});

test("normalizeActionValidators rejects invalid section-map entries", () => {
  assert.throws(
    () =>
      __testables.normalizeActionValidators(
        {
          payload: {
            normalize() {
              return {};
            }
          }
        },
        "inputValidator",
        { required: true }
      ),
    /inputValidator\[0\]\.payload\.schema is required/
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

test("normalizeActionDefinition rejects legacy assistantTool field", () => {
  assert.throws(
    () =>
      normalizeActionDefinition({
        id: "demo.workspace.settings.update",
        domain: "demo",
        version: 1,
        kind: "command",
        channels: ["automation"],
        surfaces: ["admin"],
        inputValidator: {
          schema: Type.Object({}, { additionalProperties: false })
        },
        outputValidator: {
          schema: Type.Object({}, { additionalProperties: false })
        },
        idempotency: "none",
        assistantTool: {
          description: "Legacy field"
        },
        execute: async () => ({})
      }),
    /assistantTool is not supported/
  );
});

test("normalizeActionOutputValidator accepts section-map syntax", async () => {
  const outputValidator = __testables.normalizeActionOutputValidator(
    {
      payload: createPatchValidator()
    },
    "outputValidator",
    { required: false }
  );

  assert.equal(outputValidator?.schema?.type, "object");
  assert.ok(Object.hasOwn(outputValidator?.schema?.properties || {}, "payload"));

  const normalized = await outputValidator.normalize({
    payload: {
      name: "  Acme  "
    }
  });

  assert.deepEqual(normalized, {
    payload: {
      name: "acme"
    }
  });
});

test("normalizeActionOutputValidator composes array validators", async () => {
  const outputValidator = __testables.normalizeActionOutputValidator(
    [
      createWorkspaceSlugValidator(),
      {
        payload: createPatchValidator()
      }
    ],
    "outputValidator",
    { required: false }
  );

  const properties = Object.keys(outputValidator.schema?.properties || {}).sort();
  assert.deepEqual(properties, ["payload", "workspaceSlug"]);

  const normalized = await outputValidator.normalize({
    workspaceSlug: "  TEAM-ALPHA  ",
    payload: {
      name: "  Project X  "
    }
  });

  assert.deepEqual(normalized, {
    workspaceSlug: "team-alpha",
    payload: {
      name: "project x"
    }
  });
});
