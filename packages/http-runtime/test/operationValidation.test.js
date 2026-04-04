import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import {
  validateOperationInput,
  validateOperationSection
} from "../src/shared/validators/operationValidation.js";

const patchSchema = Type.Object(
  {
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 160,
        messages: {
          minLength: "Workspace name is required."
        }
      })
    ),
    color: Type.Optional(
      Type.String({
        pattern: "^#[0-9A-Fa-f]{6}$",
        messages: {
          pattern: "Workspace color must be a hex value."
        }
      })
    ),
    invitesEnabled: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false,
    minProperties: 1,
    messages: {
      additionalProperties: "Unexpected field."
    }
  }
);

const patchOperation = Object.freeze({
  method: "PATCH",
  bodyValidator: {
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
    }
  }
});

test("validateOperationSection normalizes and validates one section", () => {
  const parsed = validateOperationSection({
    operation: patchOperation,
    section: "bodyValidator",
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
    section: "bodyValidator",
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

test("validateOperationSection converts normalizer throws into validation result", () => {
  const operationWithThrowingNormalizer = Object.freeze({
    method: "PATCH",
    bodyValidator: {
      schema: Type.Object(
        {
          temperament: Type.String({
            enum: ["calm", "playful"]
          })
        },
        {
          additionalProperties: false
        }
      ),
      normalize(value) {
        if (value?.temperament === "unknowne") {
          throw new Error("Invalid pet temperament \"unknowne\".");
        }

        return value;
      }
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithThrowingNormalizer,
    section: "bodyValidator",
    value: {
      temperament: "unknowne"
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.temperament, "string");
});

test("validateOperationSection prefers explicit thrown fieldErrors over raw fallback issues", () => {
  const operationWithFieldScopedThrow = Object.freeze({
    method: "PATCH",
    bodyValidator: {
      schema: Type.Object(
        {
          temperament: Type.String({
            enum: ["calm", "playful"]
          }),
          photoUpdatedAt: Type.Union([
            Type.String({
              format: "date-time",
              minLength: 1
            }),
            Type.Null()
          ]),
          adenovirusValidTo: Type.Union([
            Type.String({
              format: "date",
              minLength: 1
            }),
            Type.Null()
          ])
        },
        {
          additionalProperties: false
        }
      ),
      normalize() {
        const error = new Error("Invalid pet temperament \"unknowne\".");
        error.details = {
          fieldErrors: {
            temperament: "Invalid pet temperament \"unknowne\"."
          }
        };
        throw error;
      }
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithFieldScopedThrow,
    section: "bodyValidator",
    value: {
      temperament: "unknowne",
      photoUpdatedAt: "",
      adenovirusValidTo: ""
    }
  });

  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.fieldErrors, {
    temperament: "Invalid pet temperament \"unknowne\"."
  });
  assert.deepEqual(parsed.globalErrors, []);
});

test("validateOperationSection maps conditional validation failures to field errors", () => {
  const operationWithConditionalConstraint = Object.freeze({
    method: "PATCH",
    bodyValidator: {
      schema: Type.Object(
        {
          isVaccinated: Type.Boolean(),
          adenovirusValidTo: Type.Optional(Type.String({ format: "date" }))
        },
        {
          if: {
            properties: {
              isVaccinated: {
                const: true
              }
            }
          },
          then: {
            required: ["adenovirusValidTo"]
          },
          messages: {
            if: "Adenovirus valid-to date is required when vaccinated."
          }
        }
      )
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithConditionalConstraint,
    section: "bodyValidator",
    value: {
      isVaccinated: true
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.adenovirusValidTo, "Adenovirus valid-to date is required when vaccinated.");
  assert.deepEqual(parsed.globalErrors, []);
});

test("validateOperationInput validates params/query/body together", () => {
  const viewOperation = Object.freeze({
    method: "GET",
    paramsValidator: {
      schema: Type.Object(
        {
          workspaceSlug: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      )
    },
    queryValidator: {
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
