import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import {
  validateOperationInput,
  validateOperationSection
} from "../src/shared/validators/operationValidation.js";

const patchOperation = Object.freeze({
  method: "PATCH",
  body: {
    schema: createSchema({
      name: {
        type: "string",
        minLength: 1,
        maxLength: 160,
        messages: {
          minLength: "Workspace name is required."
        }
      },
      color: {
        type: "string",
        pattern: "^#[0-9A-Fa-f]{6}$",
        messages: {
          pattern: "Workspace color must be a hex value."
        }
      },
      invitesEnabled: {
        type: "boolean",
        strictBoolean: true,
        messages: {
          default: "invitesEnabled must be a boolean."
        }
      }
    })
  }
});

test("validateOperationSection validates one section and returns normalized json-rest-schema output", () => {
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
  assert.equal(typeof parsed.fieldErrors.rogueField, "string");
});

test("validateOperationSection honors json-rest-schema field message overrides", () => {
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

  const missingFieldParsed = validateOperationSection({
    operation,
    section: "body",
    value: {}
  });
  assert.equal(missingFieldParsed.ok, false);
  assert.equal(missingFieldParsed.fieldErrors.name, "Workspace name is required.");

  const strictBooleanParsed = validateOperationSection({
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
      schema: createSchema({
        temperament: {
          type: "string",
          enum: ["calm", "playful"],
          required: true
        }
      }),
      mode: "patch"
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

test("validateOperationSection rethrows malformed operation contracts", () => {
  assert.throws(
    () =>
      validateOperationSection({
        operation: {
          body: {
            schema: null,
            mode: "patch"
          }
        },
        section: "body",
        value: {}
      }),
    /must be a json-rest-schema schema instance/
  );
});

test("validateOperationSection surfaces custom validator failures as field errors", () => {
  const operationWithConditionalConstraint = Object.freeze({
    method: "PATCH",
    body: {
      schema: createSchema({
        isVaccinated: {
          type: "boolean",
          strictBoolean: true,
          required: false
        },
        adenovirusValidTo: {
          type: "string",
          required: false,
          validator(value, object = {}) {
            if (object.isVaccinated === true && !String(value || "").trim()) {
              return "Adenovirus valid-to date is required when vaccinated.";
            }
            return undefined;
          }
        }
      }),
      mode: "patch"
    }
  });

  const parsed = validateOperationSection({
    operation: operationWithConditionalConstraint,
    section: "body",
    value: {
      isVaccinated: true,
      adenovirusValidTo: ""
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
      schema: createSchema({
        workspaceSlug: { type: "string", required: true, minLength: 1 }
      }),
      mode: "patch"
    },
    query: {
      schema: createSchema({
        includeArchived: { type: "boolean", strictBoolean: true }
      }),
      mode: "patch"
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

test("validateOperationInput collects json-rest-schema field errors", () => {
  const parsed = validateOperationInput({
    operation: {
      body: {
        schema: createSchema({
          name: {
            type: "string",
            required: true,
            minLength: 1,
            messages: {
              minLength: "Name is required."
            }
          }
        }),
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
