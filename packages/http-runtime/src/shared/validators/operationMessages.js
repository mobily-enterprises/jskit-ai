import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function resolveIssueField(issue = {}) {
  const instancePath = normalizeText(issue.instancePath);
  if (instancePath) {
    const segments = instancePath
      .replace(/^\//, "")
      .split("/")
      .map((entry) => normalizeText(entry))
      .filter(Boolean);

    if (segments.length > 0) {
      return segments[0];
    }
  }

  const params = isRecord(issue.params) ? issue.params : {};
  const missingProperty = normalizeText(params.missingProperty);
  if (missingProperty) {
    return missingProperty;
  }

  const requiredProperties = Array.isArray(params.requiredProperties)
    ? params.requiredProperties
    : [];
  if (requiredProperties.length > 0) {
    return normalizeText(requiredProperties[0]);
  }

  const additionalProperties = Array.isArray(params.additionalProperties)
    ? params.additionalProperties
    : [];
  if (additionalProperties.length > 0) {
    return normalizeText(additionalProperties[0]);
  }

  const additionalProperty = normalizeText(params.additionalProperty);
  if (additionalProperty) {
    return additionalProperty;
  }

  return "";
}

function resolveMissingRequiredFields(issue = {}) {
  const params = isRecord(issue.params) ? issue.params : {};
  const requiredProperties = Array.isArray(params.requiredProperties)
    ? params.requiredProperties
    : [];

  return requiredProperties
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function resolveSchemaMessages(schema = {}) {
  const source = isRecord(schema) ? schema : {};
  const messages = source.messages;
  return isRecord(messages) ? messages : {};
}

function resolveFieldSchema(schema = {}, field = "") {
  const source = isRecord(schema) ? schema : {};
  const properties = isRecord(source.properties) ? source.properties : {};
  const fieldSchema = properties[field];
  return isRecord(fieldSchema) ? fieldSchema : null;
}

function resolveIssueMessageFromSchema(field, issue, schema = {}) {
  const keyword = normalizeText(issue?.keyword);

  if (field) {
    const fieldSchema = resolveFieldSchema(schema, field);
    const fieldMessages = resolveSchemaMessages(fieldSchema);

    const fieldKeywordMessage = normalizeText(fieldMessages[keyword]);
    if (fieldKeywordMessage) {
      return fieldKeywordMessage;
    }

    const fieldDefaultMessage = normalizeText(fieldMessages.default);
    if (fieldDefaultMessage) {
      return fieldDefaultMessage;
    }
  }

  const schemaMessages = resolveSchemaMessages(schema);
  const schemaKeywordMessage = normalizeText(schemaMessages[keyword]);
  if (schemaKeywordMessage) {
    return schemaKeywordMessage;
  }

  const schemaDefaultMessage = normalizeText(schemaMessages.default);
  if (schemaDefaultMessage) {
    return schemaDefaultMessage;
  }

  const issueMessage = normalizeText(issue?.message);
  if (issueMessage) {
    return issueMessage;
  }

  return "Invalid value.";
}

function mapOperationIssues(issues = [], schema = {}) {
  const source = Array.isArray(issues) ? issues : [];
  const fieldErrors = {};
  const globalErrors = [];

  for (const issue of source) {
    const missingRequiredFields = resolveMissingRequiredFields(issue);
    if (missingRequiredFields.length > 0) {
      for (const field of missingRequiredFields) {
        if (Object.hasOwn(fieldErrors, field)) {
          continue;
        }

        fieldErrors[field] = resolveIssueMessageFromSchema(field, issue, schema);
      }

      continue;
    }

    const field = resolveIssueField(issue);
    if (field) {
      if (!Object.hasOwn(fieldErrors, field)) {
        fieldErrors[field] = resolveIssueMessageFromSchema(field, issue, schema);
      }
      continue;
    }

    globalErrors.push(resolveIssueMessageFromSchema("", issue, schema));
  }

  return {
    fieldErrors,
    globalErrors
  };
}

export {
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues
};
