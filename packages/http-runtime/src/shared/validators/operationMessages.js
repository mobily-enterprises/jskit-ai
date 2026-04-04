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

function decodePointerSegment(value = "") {
  return String(value).replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveSchemaPathSegments(schemaPath = "") {
  const normalizedSchemaPath = normalizeText(schemaPath);
  if (!normalizedSchemaPath.startsWith("#")) {
    return [];
  }

  const pointer = normalizedSchemaPath.slice(1);
  if (!pointer) {
    return [];
  }

  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((segment) => decodePointerSegment(segment))
    .filter((segment) => segment.length > 0);
}

function resolveFieldFromSchemaPath(schemaPath = "") {
  const segments = resolveSchemaPathSegments(schemaPath);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "properties") {
      continue;
    }

    const field = normalizeText(segments[index + 1]);
    if (field) {
      return field;
    }
  }

  return "";
}

function resolveSchemaNode(schema = {}, schemaPath = "") {
  const source = isRecord(schema) ? schema : {};
  const segments = resolveSchemaPathSegments(schemaPath);
  let current = source;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return null;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return null;
    }
    current = current[segment];
  }

  return current;
}

function collectSchemaFieldCandidates(schema = {}) {
  if (!isRecord(schema)) {
    return [];
  }

  const fields = [];
  const seenFields = new Set();
  const addField = (value) => {
    const normalized = normalizeText(value);
    if (!normalized || seenFields.has(normalized)) {
      return;
    }

    seenFields.add(normalized);
    fields.push(normalized);
  };

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const field of Object.keys(properties)) {
    addField(field);
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    addField(field);
  }

  const addFromSchema = (entry) => {
    if (!isRecord(entry)) {
      return;
    }

    const entryProperties = isRecord(entry.properties) ? entry.properties : {};
    for (const field of Object.keys(entryProperties)) {
      addField(field);
    }

    const entryRequired = Array.isArray(entry.required) ? entry.required : [];
    for (const field of entryRequired) {
      addField(field);
    }
  };

  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const branches = Array.isArray(schema[keyword]) ? schema[keyword] : [];
    for (const branch of branches) {
      addFromSchema(branch);
    }
  }

  for (const keyword of ["if", "then", "else"]) {
    addFromSchema(schema[keyword]);
  }

  return fields;
}

function resolveConditionalIssueField(issue = {}, schema = {}) {
  const params = isRecord(issue.params) ? issue.params : {};
  const failingKeyword = normalizeText(params.failingKeyword).toLowerCase();
  if (failingKeyword !== "then" && failingKeyword !== "else") {
    return "";
  }

  const scopeSchema = resolveSchemaNode(schema, issue.schemaPath) || schema;
  if (!isRecord(scopeSchema)) {
    return "";
  }

  const conditionalSchema = scopeSchema[failingKeyword];
  const candidates = collectSchemaFieldCandidates(conditionalSchema);
  return candidates[0] || "";
}

function resolveFallbackIssueField(issue = {}, schema = {}) {
  const fromSchemaPath = resolveFieldFromSchemaPath(issue.schemaPath);
  if (fromSchemaPath) {
    return fromSchemaPath;
  }

  const keyword = normalizeText(issue.keyword).toLowerCase();
  if (keyword === "if") {
    return resolveConditionalIssueField(issue, schema);
  }

  return "";
}

function shouldSuppressRootUnionGlobalIssue(issue = {}, fieldErrors = {}) {
  if (Object.keys(fieldErrors).length < 1) {
    return false;
  }

  const keyword = normalizeText(issue.keyword).toLowerCase();
  if (keyword !== "anyof" && keyword !== "oneof" && keyword !== "allof") {
    return false;
  }

  const instancePath = normalizeText(issue.instancePath);
  const schemaPath = normalizeText(issue.schemaPath);
  return !instancePath && (schemaPath === "#" || schemaPath === "#/");
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

    const field = resolveIssueField(issue) || resolveFallbackIssueField(issue, schema);
    if (field) {
      if (!Object.hasOwn(fieldErrors, field)) {
        fieldErrors[field] = resolveIssueMessageFromSchema(field, issue, schema);
      }
      continue;
    }

    if (shouldSuppressRootUnionGlobalIssue(issue, fieldErrors)) {
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
