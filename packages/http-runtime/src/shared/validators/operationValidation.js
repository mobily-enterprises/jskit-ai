import { Check, Errors } from "typebox/value";
import { mapOperationIssues } from "./operationMessages.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  executeJsonRestSchemaDefinition,
  hasJsonRestSchemaDefinition,
  isSchemaDefinitionSectionMap,
  listSchemaDefinitions,
  normalizeJsonRestSchemaFieldErrors,
  selectPayloadForSchemaDefinition
} from "@jskit-ai/kernel/shared/validators";

function resolveOperationSection(operation = {}, section = "body") {
  const source = isRecord(operation) ? operation : {};
  const value = source[section];
  if (value == null) {
    return null;
  }

  return value;
}

function resolvePlainSchema(definition) {
  return isRecord(definition) && Object.prototype.hasOwnProperty.call(definition, "schema")
    ? definition.schema
    : definition;
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

  if (isSchemaDefinitionSectionMap(sectionDefinition)) {
    const source = isRecord(value) ? value : {};
    const valueResult = {};
    const normalizedResult = {};
    let ok = true;
    const fieldErrors = {};
    const globalErrors = [];
    const issues = [];

    for (const [key, entry] of Object.entries(sectionDefinition)) {
      const result = validateOperationSection({
        operation: {
          [section]: entry
        },
        section,
        value: source[key],
        context
      });

      normalizedResult[key] = result.normalized;
      valueResult[key] = result.value;
      Object.assign(fieldErrors, result.fieldErrors);
      globalErrors.push(...result.globalErrors);
      issues.push(...result.issues);
      ok = ok && result.ok;
    }

    return {
      ok,
      value: ok ? valueResult : null,
      normalized: normalizedResult,
      fieldErrors,
      globalErrors,
      issues
    };
  }

  const definitions = listSchemaDefinitions(sectionDefinition);
  if (definitions.length > 1) {
    const source = isRecord(value) ? value : {};
    let ok = true;
    let mergedValue = {};
    let mergedNormalized = {};
    const fieldErrors = {};
    const globalErrors = [];
    const issues = [];

    for (const entry of definitions) {
      const result = validateOperationSection({
        operation: {
          [section]: entry
        },
        section,
        value: selectPayloadForSchemaDefinition(entry, source, {
          context: "operation section",
          defaultMode: "patch"
        }),
        context
      });

      if (result.value && isRecord(result.value)) {
        mergedValue = { ...mergedValue, ...result.value };
      }
      if (result.normalized && isRecord(result.normalized)) {
        mergedNormalized = { ...mergedNormalized, ...result.normalized };
      }

      Object.assign(fieldErrors, result.fieldErrors);
      globalErrors.push(...result.globalErrors);
      issues.push(...result.issues);
      ok = ok && result.ok;
    }

    return {
      ok,
      value: ok ? mergedValue : null,
      normalized: mergedNormalized,
      fieldErrors,
      globalErrors,
      issues
    };
  }

  if (hasJsonRestSchemaDefinition(sectionDefinition)) {
    throw new TypeError(`Operation section "${section}" uses json-rest-schema and must be validated asynchronously.`);
  }

  const schema = resolvePlainSchema(sectionDefinition);
  if (!isRecord(schema)) {
    throw new TypeError(`Operation section \"${section}\" requires a schema object.`);
  }

  const normalized = value;
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

async function validateOperationSectionAsync({
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

  if (isSchemaDefinitionSectionMap(sectionDefinition)) {
    const source = isRecord(value) ? value : {};
    const valueResult = {};
    const normalizedResult = {};
    let ok = true;
    const fieldErrors = {};
    const globalErrors = [];

    for (const [key, entry] of Object.entries(sectionDefinition)) {
      const result = await validateOperationSectionAsync({
        operation: {
          [section]: entry
        },
        section,
        value: source[key],
        context
      });

      normalizedResult[key] = result.normalized;
      valueResult[key] = result.value;
      Object.assign(fieldErrors, result.fieldErrors);
      globalErrors.push(...result.globalErrors);
      ok = ok && result.ok;
    }

    return {
      ok,
      value: ok ? valueResult : null,
      normalized: normalizedResult,
      fieldErrors,
      globalErrors,
      issues: []
    };
  }

  const definitions = listSchemaDefinitions(sectionDefinition);
  if (definitions.length > 1) {
    const source = isRecord(value) ? value : {};
    let ok = true;
    let mergedValue = {};
    let mergedNormalized = {};
    const fieldErrors = {};
    const globalErrors = [];

    for (const entry of definitions) {
      const result = await validateOperationSectionAsync({
        operation: {
          [section]: entry
        },
        section,
        value: selectPayloadForSchemaDefinition(entry, source, {
          context: "operation section",
          defaultMode: "patch"
        }),
        context
      });

      if (result.value && isRecord(result.value)) {
        mergedValue = { ...mergedValue, ...result.value };
      }
      if (result.normalized && isRecord(result.normalized)) {
        mergedNormalized = { ...mergedNormalized, ...result.normalized };
      }

      Object.assign(fieldErrors, result.fieldErrors);
      globalErrors.push(...result.globalErrors);
      ok = ok && result.ok;
    }

    return {
      ok,
      value: ok ? mergedValue : null,
      normalized: mergedNormalized,
      fieldErrors,
      globalErrors,
      issues: []
    };
  }

  if (!hasJsonRestSchemaDefinition(sectionDefinition)) {
    return validateOperationSection({
      operation,
      section,
      value,
      context
    });
  }

  const result = await executeJsonRestSchemaDefinition(sectionDefinition, value, {
    defaultMode: "patch",
    context: `${section}`
  });
  const fieldErrors = normalizeJsonRestSchemaFieldErrors(result?.errors, sectionDefinition);

  return {
    ok: Object.keys(fieldErrors).length < 1,
    value: Object.keys(fieldErrors).length < 1 ? (result?.validatedObject ?? value) : null,
    normalized: result?.validatedObject ?? value,
    fieldErrors,
    globalErrors: [],
    issues: []
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

async function validateOperationInputAsync({
  operation = {},
  input = {},
  context = {}
} = {}) {
  const source = isRecord(input) ? input : {};
  const sectionResults = {
    params: await validateOperationSectionAsync({
      operation,
      section: "params",
      value: source.params,
      context
    }),
    query: await validateOperationSectionAsync({
      operation,
      section: "query",
      value: source.query,
      context
    }),
    body: await validateOperationSectionAsync({
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
  validateOperationSectionAsync,
  validateOperationInput,
  validateOperationInputAsync
};
