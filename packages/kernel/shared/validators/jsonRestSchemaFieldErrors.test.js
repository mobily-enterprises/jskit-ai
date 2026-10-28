import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import english from "../../locales/en.json" with { type: "json" };
import { catalogMessage, formatMessage, messageKeyForCode } from "../i18n/index.js";
import { createValidationError } from "../../server/runtime/errors.js";
import { recordIdParamsValidator } from "./recordIdParamsValidator.js";
import { codedFieldErrors, validateSchemaPayload } from "./schemaPayloadValidation.js";

function validationFailure(definition, payload) {
  try {
    validateSchemaPayload(definition, payload);
  } catch (error) {
    return error;
  }
  assert.fail("expected a schema validation error");
}

function assertCatalogRenders({ code, params }, sentEnglish) {
  const template = catalogMessage(english, messageKeyForCode(code));
  assert.notEqual(template, undefined, `${code} has no English`);
  assert.equal(formatMessage(template, params), sentEnglish, code);
}

test("each json-rest-schema error keeps its English and gains a kernel.validation.field code", () => {
  const cases = [
    ["REQUIRED", "kernel.validation.field.required", { value: { type: "string", required: true } }, {}],
    ["TYPE_CAST_FAILED", "kernel.validation.field.typeCastFailed", { value: { type: "number" } }, { value: "abc" }],
    ["NOT_NULLABLE", "kernel.validation.field.notNullable", { value: { type: "string" } }, { value: null }],
    ["MIN_LENGTH", "kernel.validation.field.minLength", { value: { type: "string", minLength: 3 } }, { value: "ab" }],
    ["MAX_LENGTH", "kernel.validation.field.maxLength", { value: { type: "string", maxLength: 1 } }, { value: "ab" }],
    ["MIN_VALUE", "kernel.validation.field.minValue", { value: { type: "number", min: 5 } }, { value: 1 }],
    ["MAX_VALUE", "kernel.validation.field.maxValue", { value: { type: "number", max: 5 } }, { value: 9 }],
    ["PATTERN", "kernel.validation.field.pattern", { value: { type: "string", pattern: "^a$" } }, { value: "b" }],
    ["ENUM_VALUE", "kernel.validation.field.enumValue", { value: { type: "string", enum: ["a"] } }, { value: "b" }],
    ["FIELD_NOT_ALLOWED", "kernel.validation.field.notAllowed", {}, { value: 1 }],
    ["STRICT_BOOLEAN", "kernel.validation.field.strictBoolean", { value: { type: "boolean", strictBoolean: true } }, { value: "true" }],
    ["RANGE_EXCEEDED", "kernel.validation.field.rangeExceeded", { value: { type: "number", length: 2 } }, { value: 12345 }],
    ["NOT_EMPTY", "kernel.validation.field.notEmpty", { value: { type: "string", notEmpty: true } }, { value: "" }]
  ];

  for (const [libraryCode, code, structure, payload] of cases) {
    const schema = createSchema(structure);
    const libraryError = schema.create(payload).errors.value;
    assert.equal(libraryError?.code, libraryCode);

    const error = validationFailure({ schema, mode: "create" }, payload);
    assert.equal(error.message, "Schema validation failed.");
    assert.equal(error.messageCode, "kernel.validation.schemaFailed");
    assert.equal(error.fieldErrors.value, libraryError.message, libraryCode);
    assert.deepEqual(error.fieldErrorCodes.value, { code, params: libraryError.params }, libraryCode);
    assert.deepEqual(error.details.fieldErrorCodes, error.fieldErrorCodes);
    assertCatalogRenders(error.fieldErrorCodes.value, error.fieldErrors.value);
  }
});

test("a custom validator's own sentence stays English without a code", () => {
  const schema = createSchema({
    slug: { type: "string", validator: (value) => value === "ok" || "Use ok." }
  });
  const error = validationFailure({ schema, mode: "create" }, { slug: "no" });

  assert.deepEqual(error.fieldErrors, { slug: "Use ok." });
  assert.equal(error.fieldErrorCodes, undefined);
  assert.deepEqual(error.details, { fieldErrors: { slug: "Use ok." } });
});

test("a field's messages override the English, and an override object gives it a code", () => {
  const schema = createSchema({
    title: {
      type: "string",
      required: true,
      minLength: 3,
      messages: {
        required: "Title is required.",
        minLength: { code: "books.title.tooShort", message: "Use at least 3 characters.", params: { field: "title" } }
      }
    },
    slug: {
      type: "string",
      validator: (value) => value === "ok" || "Use ok.",
      messages: {
        validator: { code: "books.slug.invalid", message: "Use ok." },
        default: "Slug is invalid."
      }
    },
    isbn: {
      type: "string",
      pattern: "^[0-9]+$",
      messages: {
        default: { code: "books.isbn.invalid", message: "Use digits only." }
      }
    }
  });

  const missing = validationFailure({ schema, mode: "create" }, {});
  assert.deepEqual(missing.fieldErrors, { title: "Title is required." });
  assert.equal(missing.fieldErrorCodes, undefined);

  const invalid = validationFailure({ schema, mode: "create" }, { title: "ab", slug: "no", isbn: "x" });
  assert.deepEqual(invalid.fieldErrors, {
    title: "Use at least 3 characters.",
    slug: "Use ok.",
    isbn: "Use digits only."
  });
  assert.deepEqual(invalid.fieldErrorCodes, {
    title: { code: "books.title.tooShort", params: { min: 3, actual: 2, field: "title" } },
    slug: { code: "books.slug.invalid", params: {} },
    isbn: { code: "books.isbn.invalid", params: { pattern: "^[0-9]+$" } }
  });

  // The validator override is only for the validator's failure; others use default.
  const nullError = validationFailure({ schema, mode: "patch" }, { slug: null });
  assert.deepEqual(nullError.fieldErrors, { slug: "Slug is invalid." });
  assert.equal(nullError.fieldErrorCodes, undefined);
});

test("the record id override renders from kernel.validation.recordIdInvalid", () => {
  const error = validationFailure(recordIdParamsValidator, { recordId: "007" });

  assert.deepEqual(error.fieldErrors, { recordId: "Record id must be a canonical positive integer string." });
  assert.deepEqual(error.fieldErrorCodes, {
    recordId: { code: "kernel.validation.recordIdInvalid", params: { pattern: "^[1-9][0-9]*$" } }
  });
  assertCatalogRenders(error.fieldErrorCodes.recordId, error.fieldErrors.recordId);
});

test("codedFieldErrors turns a schema validation error into createValidationError's input", () => {
  const schema = createSchema({
    title: { type: "string", required: true },
    slug: { type: "string", validator: () => "Use ok." }
  });
  const error = validationFailure({ schema, mode: "create" }, { slug: "x" });
  const validationError = createValidationError(codedFieldErrors(error));

  assert.deepEqual(validationError.details, {
    fieldErrors: { title: "Field is required", slug: "Use ok." },
    fieldErrorCodes: { title: { code: "kernel.validation.field.required", params: {} } }
  });
  assert.equal(codedFieldErrors(new Error("plain")), null);
});
