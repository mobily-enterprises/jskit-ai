import { DomainValidationError } from "./errors.js";

function normalizeFieldName(value, index) {
  const normalized = String(value || "").trim();
  if (normalized) {
    return normalized;
  }
  return `field_${index + 1}`;
}

function normalizeFailureMessage(outcome, fallbackMessage) {
  if (typeof outcome === "string") {
    const normalized = outcome.trim();
    if (normalized) {
      return normalized;
    }
  }

  if (outcome === false) {
    const fallback = String(fallbackMessage || "").trim();
    return fallback || "Invalid value.";
  }

  if (outcome && typeof outcome === "object" && outcome.ok === false) {
    const outcomeMessage = String(outcome.message || "").trim();
    if (outcomeMessage) {
      return outcomeMessage;
    }

    const fallback = String(fallbackMessage || "").trim();
    return fallback || "Invalid value.";
  }

  return null;
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {
      message: "Domain validation failed.",
      code: "domain_validation_failed"
    };
  }

  const message = String(options.message || "").trim() || "Domain validation failed.";
  const code = String(options.code || "").trim() || "domain_validation_failed";

  return {
    message,
    code
  };
}

async function runDomainRules(rules, options = {}) {
  if (!Array.isArray(rules)) {
    throw new TypeError("runDomainRules requires an array of rules.");
  }

  const { message, code } = normalizeOptions(options);
  const fieldErrors = {};

  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new TypeError(`runDomainRules rule at index ${index} must be an object.`);
    }

    if (typeof rule.check !== "function") {
      throw new TypeError(`runDomainRules rule at index ${index} requires check().`);
    }

    const enabled =
      typeof rule.when === "function"
        ? await rule.when()
        : rule.when !== false;

    if (!enabled) {
      continue;
    }

    const outcome = await rule.check();
    const failureMessage = normalizeFailureMessage(outcome, rule.message);
    if (!failureMessage) {
      continue;
    }

    const fieldName = normalizeFieldName(rule.field, index);
    fieldErrors[fieldName] = failureMessage;
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new DomainValidationError(
      {
        fieldErrors
      },
      {
        message,
        code
      }
    );
  }
}

export { runDomainRules };
