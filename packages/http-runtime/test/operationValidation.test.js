import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { createSchema } from "json-rest-schema";
import {
  validateOperationInput,
  validateOperationInputAsync,
  validateOperationSection,
  validateOperationSectionAsync
} from "../src/shared/validators/operationValidation.js";

function createMockJsonRestSchema() {
  return {
    async create(payload = {}) {
      const value = payload && typeof payload === "object" ? payload : {};
      const name = String(value.name || "").trim();
      const errors = {};
      if (!name) {
        errors.name = {
          message: "Name is required."
        };
      }

      return {
        validatedObject: Object.keys(errors).length < 1 ? { name } : {},
        errors
      };
    },
    async replace(payload = {}) {
      return this.create(payload);
    },
    async patch(payload = {}) {
      const value = payload && typeof payload === "object" ? payload : {};
      if (!Object.hasOwn(value, "name")) {
        return {
          validatedObject: {},
          errors: {}
        };
      }

      return this.create(value);
    },
    toJsonSchema() {
      return {
        type: "object",
        properties: {
          name: {
            type: "string"
          }
        },
        additionalProperties: false
      };
    }
  };
}

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
  body: {
    schema: patchSchema
  }
});

test("validateOperationSection validates one section without reshaping typebox input", () => {
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
  assert.equal(parsed.value.name, "  Acme  ");
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

test("validateOperationSectionAsync honors json-rest-schema field message overrides", async () => {
  const operation = Object.freeze({
    method: "POST",
    body: {
      schema: createSchema({
        name: {
          type: "string",
          required: true,
          messages: {
            required: "Workspace name is required."
          }
        },
        invitesEnabled: {
          type: "boolean",
          required: true,
          strictBoolean: true,
          messages: {
            default: "invitesEnabled must be a boolean."
          }
        }
      }),
      mode: "create"
    }
  });

  const missingFieldParsed = await validateOperationSectionAsync({
    operation,
    section: "body",
    value: {}
  });
  assert.equal(missingFieldParsed.ok, false);
  assert.equal(missingFieldParsed.fieldErrors.name, "Workspace name is required.");

  const strictBooleanParsed = await validateOperationSectionAsync({
    operation,
    section: "body",
    value: {
      name: "Acme",
      invitesEnabled: "yes"
    }
  });
  assert.equal(strictBooleanParsed.ok, false);
  assert.equal(strictBooleanParsed.fieldErrors.invitesEnabled, "invitesEnabled must be a boolean.");
});

test("validateOperationSection returns field errors for invalid enum values", () => {
  const operationWithEnumConstraint = Object.freeze({
    method: "PATCH",
    body: {
      schema: Type.Object(
        {
          temperament: Type.String({
            enum: ["calm", "playful"]
          })
        },
        {
          additionalProperties: false
        }
      )
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithEnumConstraint,
    section: "body",
    value: {
      temperament: "unknowne"
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.temperament, "string");
});

test("validateOperationSection reports the raw schema field issues for invalid payloads", () => {
  const operationWithFieldConstraints = Object.freeze({
    method: "PATCH",
    body: {
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
      )
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithFieldConstraints,
    section: "body",
    value: {
      temperament: "unknowne",
      photoUpdatedAt: "",
      adenovirusValidTo: ""
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.temperament, "string");
  assert.equal(typeof parsed.fieldErrors.photoUpdatedAt, "string");
  assert.equal(typeof parsed.fieldErrors.adenovirusValidTo, "string");
  assert.deepEqual(parsed.globalErrors, []);
});

test("validateOperationSection maps conditional validation failures to field errors", () => {
  const operationWithConditionalConstraint = Object.freeze({
    method: "PATCH",
    body: {
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
    section: "body",
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
      )
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
  assert.deepEqual(parsed.value.query, {});
  assert.equal(parsed.value.body, undefined);
});

test("validateOperationSectionAsync validates json-rest-schema validators", async () => {
  const parsed = await validateOperationSectionAsync({
    operation: {
      body: {
        schema: createMockJsonRestSchema(),
        mode: "patch"
      }
    },
    section: "body",
    value: {
      name: "  Acme  "
    }
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    name: "Acme"
  });
});

test("validateOperationInputAsync collects json-rest-schema field errors", async () => {
  const parsed = await validateOperationInputAsync({
    operation: {
      body: {
        schema: createMockJsonRestSchema(),
        mode: "patch"
      }
    },
    input: {
      body: {
        name: "   "
      }
    }
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.fieldErrors.name, "Name is required.");
});
