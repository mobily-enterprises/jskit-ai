import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { tallyDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const formIdField = { type: "string", required: true, noTrim: true,
  validator: (value) => /^[A-Za-z0-9_-]{1,128}$/u.test(value) || "Enter a Tally form ID, not a URL." };
const blocksField = { type: "array", validator: (value) => value.length <= 500 &&
  value.every((block) => block && typeof block === "object" && !Array.isArray(block) && typeof block.type === "string") || "Supply up to 500 native Tally block objects." };
const statusField = { type: "string", enum: ["BLANK", "DRAFT", "PUBLISHED"] };
const formResult = (result) => typeof result?.id === "string" && typeof result.name === "string" &&
  ["BLANK", "DRAFT", "PUBLISHED"].includes(result.status);
const formGetSchema = createSchema({ formId: formIdField });
const formUpdateSchema = createSchema({ formId: formIdField,
  name: { type: "string", maxLength: 1000 }, status: statusField, blocks: blocksField });

const submissionsSchema = createSchema({
  formId: { type: "string", required: true, noTrim: true,
    validator: (value) => /^[A-Za-z0-9_-]{1,128}$/u.test(value) || "Enter a Tally form ID, not a URL." },
  page: { type: "integer", min: 1, defaultTo: 1 },
  limit: { type: "integer", min: 1, max: 500, defaultTo: 50 },
  filter: { type: "string", enum: ["all", "completed", "partial"], defaultTo: "completed" },
  afterId: { type: "string", noTrim: true,
    validator: (value) => /^[A-Za-z0-9_-]{1,128}$/u.test(value) || "Use the returned submission ID." }
});

const tallyProvider = Object.freeze({
  ...tallyDefinition, apiOrigins: ["https://api.tally.so"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}`, "tally-version": "2025-02-01" }) },
  checkOperation: "forms.list",
  operations: {
    "forms.create": jsonOperation("https://api.tally.so/forms", {
      workspaceId: { ...formIdField, required: false },
      templateId: { ...formIdField, required: false },
      folderId: { ...formIdField, required: false },
      status: { ...statusField, defaultTo: "DRAFT" },
      blocks: { ...blocksField, required: true }
    }, formResult, "POST"),
    "forms.get": {
      scopes: [],
      request(input) {
        const { formId } = validateSchemaPayload({ schema: formGetSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: `https://api.tally.so/forms/${formId}` };
      },
      validateResult: (result) => formResult(result) && Array.isArray(result.blocks)
    },
    "forms.update": {
      scopes: [],
      request(input) {
        const { formId, ...body } = validateSchemaPayload({ schema: formUpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Choose a name, status or block change.", { statusCode: 422 });
        return { method: "PATCH", url: `https://api.tally.so/forms/${formId}`, body };
      },
      validateResult: formResult
    },
    "submissions.list": {
      scopes: [],
      request(input) {
        const { formId, ...values } = validateSchemaPayload({ schema: submissionsSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(`https://api.tally.so/forms/${formId}/submissions`);
        for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
        return { method: "GET", url: url.href };
      },
      validateResult: (result) => Number.isSafeInteger(result?.page) && result.page >= 1 &&
        Number.isSafeInteger(result.limit) && result.limit >= 1 && result.limit <= 500 &&
        typeof result.hasMore === "boolean" && Array.isArray(result.questions) &&
        Array.isArray(result.submissions) && result.submissions.every((submission) =>
          typeof submission?.id === "string" && typeof submission.formId === "string" &&
          typeof submission.isCompleted === "boolean" && Array.isArray(submission.responses))
    },
    "forms.list": jsonOperation("https://api.tally.so/forms", {
      limit: { type: "integer", min: 1, max: 500, defaultTo: 50 },
      page: { type: "integer", min: 1, defaultTo: 1 }
    }, (result) => Array.isArray(result?.items) && Number.isInteger(result.total) && typeof result.hasMore === "boolean")
  }
});
export { tallyProvider };
