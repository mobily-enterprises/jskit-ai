import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { Errors } from "typebox/value";
import {
  mapOperationIssues,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveSchemaMessages
} from "../src/shared/validators/operationMessages.js";

const sampleSchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      messages: {
        required: "Workspace name is required.",
        minLength: "Workspace name is required.",
        default: "Invalid workspace name."
      }
    }),
    color: Type.String({
      pattern: "^#[0-9A-Fa-f]{6}$",
      messages: {
        pattern: "Workspace color must be a hex value."
      }
    }),
    invitesEnabled: Type.Boolean({
      messages: {
        default: "invitesEnabled must be true or false."
      }
    })
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field."
    }
  }
);

test("resolveIssueField resolves missing and nested fields", () => {
  const missingIssues = [...Errors(sampleSchema, { color: "#0F6B54", invitesEnabled: true })];
  const requiredIssue = missingIssues.find((entry) => entry.keyword === "required");

  assert.equal(resolveIssueField(requiredIssue), "name");
  assert.deepEqual(resolveMissingRequiredFields(requiredIssue), ["name"]);

  const nestedSchema = Type.Object(
    {
      profile: Type.Object(
        {
          displayName: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      )
    },
    { additionalProperties: false }
  );

  const nestedIssues = [...Errors(nestedSchema, { profile: { displayName: "" } })];
  const minLengthIssue = nestedIssues.find((entry) => entry.keyword === "minLength");
  assert.equal(resolveIssueField(minLengthIssue), "profile");
});

test("mapOperationIssues applies field message overrides by keyword", () => {
  const issues = [...Errors(sampleSchema, { name: "", color: "oops", invitesEnabled: "yes" })];
  const mapped = mapOperationIssues(issues, sampleSchema);

  assert.equal(mapped.fieldErrors.name, "Workspace name is required.");
  assert.equal(mapped.fieldErrors.color, "Workspace color must be a hex value.");
  assert.equal(mapped.fieldErrors.invitesEnabled, "invitesEnabled must be true or false.");
  assert.deepEqual(mapped.globalErrors, []);
});

test("mapOperationIssues falls back to keyword/global messages", () => {
  const issues = [...Errors(sampleSchema, { color: "#0F6B54", invitesEnabled: true, extra: "x" })];
  const mapped = mapOperationIssues(issues, sampleSchema);

  assert.equal(mapped.fieldErrors.extra, "Unexpected field.");
});

test("mapOperationIssues maps conditional schema failures to field errors", () => {
  const conditionalSchema = Type.Object(
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
  );

  const issues = [...Errors(conditionalSchema, { isVaccinated: true })];
  const mapped = mapOperationIssues(issues, conditionalSchema);

  assert.equal(mapped.fieldErrors.adenovirusValidTo, "Adenovirus valid-to date is required when vaccinated.");
  assert.deepEqual(mapped.globalErrors, []);
});

test("mapOperationIssues suppresses redundant root anyOf global issue when field errors exist", () => {
  const unionSchema = Type.Union([
    Type.Object(
      {
        kind: Type.Literal("dog"),
        bark: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        kind: Type.Literal("cat"),
        meow: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  ]);

  const issues = [...Errors(unionSchema, { kind: "dog", bark: "" })];
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
