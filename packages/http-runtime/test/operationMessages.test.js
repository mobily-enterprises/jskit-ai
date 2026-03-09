import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { Errors } from "typebox/value";
import {
  mapOperationIssues,
  resolveIssueField,
  resolveMissingRequiredFields
} from "../src/shared/contracts/operationMessages.js";

const sampleSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
    invitesEnabled: Type.Boolean()
  },
  { additionalProperties: false }
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
  const mapped = mapOperationIssues(issues, {
    fields: {
      name: {
        minLength: "Workspace name is required.",
        default: "Invalid workspace name."
      },
      color: {
        pattern: "Workspace color must be a hex value."
      },
      invitesEnabled: {
        default: "invitesEnabled must be true or false."
      }
    }
  });

  assert.equal(mapped.fieldErrors.name, "Workspace name is required.");
  assert.equal(mapped.fieldErrors.color, "Workspace color must be a hex value.");
  assert.equal(mapped.fieldErrors.invitesEnabled, "invitesEnabled must be true or false.");
  assert.deepEqual(mapped.globalErrors, []);
});

test("mapOperationIssues falls back to keyword/global messages", () => {
  const issues = [...Errors(sampleSchema, { color: "#0F6B54", invitesEnabled: true, extra: "x" })];
  const mapped = mapOperationIssues(issues, {
    keywords: {
      additionalProperties: "Unexpected field."
    },
    default: "Invalid value."
  });

  assert.equal(mapped.fieldErrors.extra, "Unexpected field.");
});
