import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import {
  validateOperationInput,
  validateOperationSection
} from "../src/shared/contracts/operationValidation.js";

const patchSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    color: Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" })),
    invitesEnabled: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const patchOperation = Object.freeze({
  method: "PATCH",
  body: {
    schema: patchSchema,
    normalize: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
      }

      const normalized = {
        ...value
      };

      if (Object.hasOwn(normalized, "name")) {
        normalized.name = String(normalized.name || "").trim();
      }

      return normalized;
    },
    messages: {
      fields: {
        name: {
          minLength: "Workspace name is required."
        },
        color: {
          pattern: "Workspace color must be a hex value."
        }
      },
      keywords: {
        additionalProperties: "Unexpected field."
      }
    }
  }
});

test("validateOperationSection normalizes and validates one section", () => {
  const parsed = validateOperationSection({
    operation: patchOperation,
    section: "body",
    value: {
      name: "  Acme  ",
      color: "#0F6B54"
    }
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.fieldErrors, {});
  assert.equal(parsed.value.name, "Acme");
});

test("validateOperationSection returns shared field errors", () => {
  const parsed = validateOperationSection({
    operation: patchOperation,
    section: "body",
    value: {
      name: "",
      color: "bad",
      rogueField: true
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.name, "Workspace name is required.");
  assert.equal(parsed.fieldErrors.color, "Workspace color must be a hex value.");
  assert.equal(parsed.fieldErrors.rogueField, "Unexpected field.");
});

test("validateOperationInput validates params/query/body together", () => {
  const viewOperation = Object.freeze({
    method: "GET",
    params: {
      schema: Type.Object(
        {
          workspaceSlug: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      )
    },
    query: {
      schema: Type.Object(
        {
          includeArchived: Type.Optional(Type.Boolean())
        },
        { additionalProperties: false }
      ),
      normalize: (value) => {
        if (!value || typeof value !== "object") {
          return {};
        }

        return {
          includeArchived: value.includeArchived === true
        };
      }
    }
  });

  const parsed = validateOperationInput({
    operation: viewOperation,
    input: {
      params: {
        workspaceSlug: "acme"
      },
      query: {}
    }
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.params.workspaceSlug, "acme");
  assert.equal(parsed.value.query.includeArchived, false);
  assert.equal(parsed.value.body, undefined);
});
