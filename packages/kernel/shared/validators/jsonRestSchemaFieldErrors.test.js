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

/**
 * The schema, its create() failing `field` with `libraryError`, as json-rest-schema
 * 1.0.18's minItems and maxItems validators fail it. The kernel installs 1.0.17,
 * which checks neither; once it requires 1.0.18 these cases join the table above.
 */
function failingWith(schema, field, libraryError) {
  return Object.assign(Object.create(schema), {
    create: () => ({ validatedObject: {}, errors: { [field]: { field, ...libraryError } } })
  });
}

// json-rest-schema 1.0.18's own MIN_ITEMS and MAX_ITEMS errors (src/core/CorePlugin.js).
function minItemsError(min, actual) {
  return { code: "MIN_ITEMS", message: `Must have at least ${min} items.`, params: { min, actual } };
}
function maxItemsError(max, actual) {
  return { code: "MAX_ITEMS", message: `Must have no more than ${max} items.`, params: { max, actual } };
}

test("MIN_ITEMS and MAX_ITEMS keep their English and gain kernel.validation.field codes", () => {
  const cases = [
    [minItemsError(2, 1), "kernel.validation.field.minItems"],
    [maxItemsError(2, 3), "kernel.validation.field.maxItems"]
  ];

  for (const [libraryError, code] of cases) {
    const schema = failingWith(createSchema({ value: { type: "array", minItems: 2, maxItems: 2 } }), "value", libraryError);
    const error = validationFailure({ schema, mode: "create" }, { value: [] });
    assert.equal(error.messageCode, "kernel.validation.schemaFailed");
    assert.equal(error.fieldErrors.value, libraryError.message, libraryError.code);
    assert.deepEqual(error.fieldErrorCodes.value, { code, params: libraryError.params }, libraryError.code);
    assertCatalogRenders(error.fieldErrorCodes.value, error.fieldErrors.value);
  }
});

test("an array field's minItems and maxItems messages override its English", () => {
  const schema = createSchema({
    tags: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      messages: {
        minItems: "Pick a tag.",
        maxItems: { code: "books.tags.tooMany", message: "Pick at most 2 tags." }
      }
    }
  });

  const empty = validationFailure({ schema: failingWith(schema, "tags", minItemsError(1, 0)), mode: "create" }, { tags: [] });
  assert.deepEqual(empty.fieldErrors, { tags: "Pick a tag." });
  assert.equal(empty.fieldErrorCodes, undefined);

  const full = validationFailure({ schema: failingWith(schema, "tags", maxItemsError(2, 3)), mode: "create" }, { tags: ["a", "b", "c"] });
  assert.deepEqual(full.fieldErrors, { tags: "Pick at most 2 tags." });
  assert.deepEqual(full.fieldErrorCodes, { tags: { code: "books.tags.tooMany", params: { max: 2, actual: 3 } } });
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
