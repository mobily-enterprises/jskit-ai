function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

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

function normalizeMessages(messages = {}) {
  const source = isRecord(messages) ? messages : {};
  const fields = isRecord(source.fields) ? source.fields : {};
  const keywords = isRecord(source.keywords) ? source.keywords : {};
  const fallback = normalizeText(source.default) || "Invalid value.";

  return {
    fields,
    keywords,
    default: fallback
  };
}

function resolveIssueMessage(field, issue, messages = {}) {
  const normalizedMessages = normalizeMessages(messages);
  const keyword = normalizeText(issue?.keyword);

  if (field) {
    const fieldMessages = isRecord(normalizedMessages.fields[field])
      ? normalizedMessages.fields[field]
      : {};

    const keywordMessage = normalizeText(fieldMessages[keyword]);
    if (keywordMessage) {
      return keywordMessage;
    }

    const fieldDefault = normalizeText(fieldMessages.default);
    if (fieldDefault) {
      return fieldDefault;
    }
  }

  const keywordFallback = normalizeText(normalizedMessages.keywords[keyword]);
  if (keywordFallback) {
    return keywordFallback;
  }

  const issueMessage = normalizeText(issue?.message);
  if (issueMessage) {
    return issueMessage;
  }

  return normalizedMessages.default;
}

function mapOperationIssues(issues = [], messages = {}) {
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

        fieldErrors[field] = resolveIssueMessage(field, issue, messages);
      }

      continue;
    }

    const field = resolveIssueField(issue);
    if (field) {
      if (!Object.hasOwn(fieldErrors, field)) {
        fieldErrors[field] = resolveIssueMessage(field, issue, messages);
      }
      continue;
    }

    globalErrors.push(resolveIssueMessage("", issue, messages));
  }

  return {
    fieldErrors,
    globalErrors
  };
}

export {
  normalizeMessages,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessage,
  mapOperationIssues
};
