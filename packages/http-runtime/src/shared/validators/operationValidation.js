import { Check, Errors } from "typebox/value";
import { mapOperationIssues } from "./operationMessages.js";
import { resolveFieldErrors } from "../support/fieldErrors.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

function defaultNormalize(value) {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...value
  };
}

function resolveOperationSection(operation = {}, section = "bodyValidator") {
  const source = isRecord(operation) ? operation : {};
  const value = source[section];
  if (!isRecord(value)) {
    return null;
  }

  return value;
}

function validateOperationSection({
  operation = {},
  section = "bodyValidator",
  value,
  context = {}
} = {}) {
  const sectionDefinition = resolveOperationSection(operation, section);
  if (!sectionDefinition) {
    return {
      ok: true,
      value,
      normalized: value,
      fieldErrors: {},
      globalErrors: [],
      issues: []
    };
  }

  const schema = sectionDefinition.schema;
  if (!isRecord(schema)) {
    throw new TypeError(`Operation section \"${section}\" requires a schema object.`);
  }

  const normalize = typeof sectionDefinition.normalize === "function"
    ? sectionDefinition.normalize
    : defaultNormalize;

  let normalized = null;
  try {
    normalized = normalize(value, context);
  } catch (error) {
    const explicitFieldErrors = resolveFieldErrors(error);
    if (Object.keys(explicitFieldErrors).length > 0) {
      return {
        ok: false,
        value: null,
        normalized: value,
        fieldErrors: explicitFieldErrors,
        globalErrors: [],
        issues: []
      };
    }

    // If normalization throws, still surface field-level schema issues when possible.
    const fallbackIssues = Check(schema, value) ? [] : [...Errors(schema, value)];
    if (fallbackIssues.length > 0) {
      const mapped = mapOperationIssues(fallbackIssues, schema);
      return {
        ok: false,
        value: null,
        normalized: value,
        fieldErrors: mapped.fieldErrors,
        globalErrors: mapped.globalErrors,
        issues: fallbackIssues
      };
    }

    const fallbackMessage = String(error?.message || "Invalid value.").trim() || "Invalid value.";
    return {
      ok: false,
      value: null,
      normalized: value,
      fieldErrors: {},
      globalErrors: [fallbackMessage],
      issues: []
    };
  }

  const issues = Check(schema, normalized) ? [] : [...Errors(schema, normalized)];
  const mapped = mapOperationIssues(issues, schema);

  return {
    ok: issues.length < 1,
    value: issues.length < 1 ? normalized : null,
    normalized,
    fieldErrors: mapped.fieldErrors,
    globalErrors: mapped.globalErrors,
    issues
  };
}

function validateOperationInput({
  operation = {},
  input = {},
  context = {}
} = {}) {
  const source = isRecord(input) ? input : {};
  const sectionResults = {
    paramsValidator: validateOperationSection({
      operation,
      section: "paramsValidator",
      value: source.params,
      context
    }),
    queryValidator: validateOperationSection({
      operation,
      section: "queryValidator",
      value: source.query,
      context
    }),
    bodyValidator: validateOperationSection({
      operation,
      section: "bodyValidator",
      value: source.body,
      context
    })
  };

  const fieldErrors = {
    ...sectionResults.paramsValidator.fieldErrors,
    ...sectionResults.queryValidator.fieldErrors,
    ...sectionResults.bodyValidator.fieldErrors
  };

  const globalErrors = [
    ...sectionResults.paramsValidator.globalErrors,
    ...sectionResults.queryValidator.globalErrors,
    ...sectionResults.bodyValidator.globalErrors
  ];

  return {
    ok: sectionResults.paramsValidator.ok && sectionResults.queryValidator.ok && sectionResults.bodyValidator.ok,
    value: {
      params: sectionResults.paramsValidator.value,
      query: sectionResults.queryValidator.value,
      body: sectionResults.bodyValidator.value
    },
    normalized: {
      params: sectionResults.paramsValidator.normalized,
      query: sectionResults.queryValidator.normalized,
      body: sectionResults.bodyValidator.normalized
    },
    fieldErrors,
    globalErrors,
    sections: sectionResults
  };
}

export {
  validateOperationSection,
  validateOperationInput
};
