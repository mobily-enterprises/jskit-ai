import assert from "node:assert/strict";
import test from "node:test";
import {
  mapOperationIssues,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveSchemaMessages
} from "../src/shared/validators/operationMessages.js";

const sampleSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      minLength: 1,
      messages: {
        required: "Workspace name is required.",
        minLength: "Workspace name is required.",
        default: "Invalid workspace name."
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
      messages: {
        default: "invitesEnabled must be true or false."
      }
    }
  },
  additionalProperties: false,
  messages: {
    additionalProperties: "Unexpected field."
  }
};

test("resolveIssueField resolves missing and nested fields", () => {
  const requiredIssue = {
    keyword: "required",
    params: {
      missingProperty: "name",
      requiredProperties: ["name"]
    }
  };

  assert.equal(resolveIssueField(requiredIssue), "name");
  assert.deepEqual(resolveMissingRequiredFields(requiredIssue), ["name"]);

  const minLengthIssue = {
    keyword: "minLength",
    instancePath: "/profile/displayName"
  };
  assert.equal(resolveIssueField(minLengthIssue), "profile");
});

test("mapOperationIssues applies field message overrides by keyword", () => {
  const issues = [
    {
      keyword: "minLength",
      instancePath: "/name"
    },
    {
      keyword: "pattern",
      instancePath: "/color"
    },
    {
      keyword: "type",
      instancePath: "/invitesEnabled"
    }
  ];
  const mapped = mapOperationIssues(issues, sampleSchema);

  assert.equal(mapped.fieldErrors.name, "Workspace name is required.");
  assert.equal(mapped.fieldErrors.color, "Workspace color must be a hex value.");
  assert.equal(mapped.fieldErrors.invitesEnabled, "invitesEnabled must be true or false.");
  assert.deepEqual(mapped.globalErrors, []);
});

test("mapOperationIssues falls back to keyword/global messages", () => {
  const issues = [
    {
      keyword: "additionalProperties",
      params: {
        additionalProperty: "extra"
      }
    }
  ];
  const mapped = mapOperationIssues(issues, sampleSchema);

  assert.equal(mapped.fieldErrors.extra, "Unexpected field.");
});

test("mapOperationIssues maps conditional schema failures to field errors", () => {
  const conditionalSchema = {
    type: "object",
    properties: {
      isVaccinated: {
        type: "boolean"
      },
      adenovirusValidTo: {
        type: "string"
      }
    },
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
  };

  const issues = [
    {
      keyword: "if",
      schemaPath: "#",
      params: {
        failingKeyword: "then"
      }
    }
  ];
  const mapped = mapOperationIssues(issues, conditionalSchema);

  assert.equal(mapped.fieldErrors.adenovirusValidTo, "Adenovirus valid-to date is required when vaccinated.");
  assert.deepEqual(mapped.globalErrors, []);
});

test("mapOperationIssues suppresses redundant root anyOf global issue when field errors exist", () => {
  const unionSchema = {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            const: "dog"
          },
          bark: {
            type: "string",
            minLength: 1
          }
        },
        additionalProperties: false
      },
      {
        type: "object",
        properties: {
          kind: {
            const: "cat"
          },
          meow: {
            type: "string",
            minLength: 1
          }
        },
        additionalProperties: false
      }
    ]
  };

  const issues = [
    {
      keyword: "minLength",
      instancePath: "/bark"
    },
    {
      keyword: "anyOf",
      schemaPath: "#"
    }
  ];
  const mapped = mapOperationIssues(issues, unionSchema);

  assert.equal(typeof mapped.fieldErrors.bark, "string");
  assert.deepEqual(mapped.globalErrors, []);
});

test("schema message helpers resolve field and root messages", () => {
  const nameSchema = resolveFieldSchema(sampleSchema, "name");
  assert.equal(typeof nameSchema, "object");

  const nameMessages = resolveSchemaMessages(nameSchema);
  const rootMessages = resolveSchemaMessages(sampleSchema);

  assert.equal(nameMessages.minLength, "Workspace name is required.");
  assert.equal(rootMessages.additionalProperties, "Unexpected field.");
});
