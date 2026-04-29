import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

function resolveOperationSection(operation = {}, section = "body") {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return null;
  }

  return operation[section] == null ? null : operation[section];
}

function buildValidationSuccessResult(value) {
  return {
    ok: true,
    value,
    normalized: value,
    fieldErrors: {},
    globalErrors: [],
    issues: []
  };
}

function isFieldValidationError(error) {
  return Boolean(error?.fieldErrors && typeof error.fieldErrors === "object");
}

function buildValidationFailureResult(error, normalized) {
  return {
    ok: false,
    value: null,
    normalized,
    fieldErrors: error.fieldErrors,
    globalErrors: [],
    issues: []
  };
}

function validateOperationSection({
  operation = {},
  section = "body",
  value,
  context = {}
} = {}) {
  const sectionDefinition = resolveOperationSection(operation, section);
  if (!sectionDefinition) {
    return buildValidationSuccessResult(value);
  }

  try {
    const normalized = validateSchemaPayload(sectionDefinition, value, {
      phase: "input",
      context: `operation section "${section}"`
    });

    return buildValidationSuccessResult(normalized);
  } catch (error) {
    if (!isFieldValidationError(error)) {
      throw error;
    }

    return buildValidationFailureResult(error, value);
  }
}

function validateOperationInput({
  operation = {},
  input = {},
  context = {}
} = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
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
    issues: [
      ...sectionResults.params.issues,
      ...sectionResults.query.issues,
      ...sectionResults.body.issues
    ]
  };
}

export {
  validateOperationSection,
  validateOperationInput
};
