import { DomainValidationError } from "./errors.js";

function collectDomainFieldErrors(rules) {
  const fieldErrors = {};

  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.when && !rule.when()) {
      continue;
    }

    const outcome = rule?.check ? rule.check() : null;
    if (!outcome) {
      continue;
    }

    if (typeof outcome === "string") {
      fieldErrors[rule.field] = outcome;
      continue;
    }

    if (typeof outcome === "object") {
      fieldErrors[rule.field] = outcome?.message || "domain rule failed";
    }
  }

  return fieldErrors;
}

function assertNoDomainRuleFailures(
  rules,
  {
    message = "Domain validation failed.",
    code = "domain_validation_failed"
  } = {}
) {
  const fieldErrors = collectDomainFieldErrors(rules);
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

export { collectDomainFieldErrors, assertNoDomainRuleFailures };
