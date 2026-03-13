import { Check, Errors } from "typebox/value";
import { mapOperationIssues } from "./operationMessages.js";

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function defaultNormalize(value) {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...value
  };
}

function resolveOperationSection(operation = {}, section = "body") {
  const source = isRecord(operation) ? operation : {};
  const value = source[section];
  if (!isRecord(value)) {
    return null;
  }

  return value;
}

function validateOperationSection({
  operation = {},
  section = "body",
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

  const normalized = normalize(value, context);
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
    params: validateOperationSection({
      operation,
      section: "params",
      value: source.params,
      context
    }),
    query: validateOperationSection({
      operation,
      section: "query",
      value: source.query,
      context
    }),
    body: validateOperationSection({
      operation,
      section: "body",
      value: source.body,
      context
    })
  };

  const fieldErrors = {
    ...sectionResults.params.fieldErrors,
    ...sectionResults.query.fieldErrors,
    ...sectionResults.body.fieldErrors
  };

  const globalErrors = [
    ...sectionResults.params.globalErrors,
    ...sectionResults.query.globalErrors,
    ...sectionResults.body.globalErrors
  ];

  return {
    ok: sectionResults.params.ok && sectionResults.query.ok && sectionResults.body.ok,
    value: {
      params: sectionResults.params.value,
      query: sectionResults.query.value,
      body: sectionResults.body.value
    },
    normalized: {
      params: sectionResults.params.normalized,
      query: sectionResults.query.normalized,
      body: sectionResults.body.normalized
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
