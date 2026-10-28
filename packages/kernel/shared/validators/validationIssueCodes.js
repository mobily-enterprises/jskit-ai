import { isRecord } from "../support/normalize.js";

// Fastify validates request schemas with Ajv. These keywords have fixed English
// (Ajv 8), so each issue renders from kernel.validation.<keyword> with Ajv's own
// params. Keywords whose sentence varies (contains, dependencies) stay English only.
const VALIDATION_ISSUE_CODES = new Map([
  { keyword: "required", code: "kernel.validation.required" },
  { keyword: "type", code: "kernel.validation.type" },
  { keyword: "minLength", code: "kernel.validation.minLength" },
  { keyword: "maxLength", code: "kernel.validation.maxLength" },
  { keyword: "minimum", code: "kernel.validation.minimum" },
  { keyword: "maximum", code: "kernel.validation.maximum" },
  { keyword: "exclusiveMinimum", code: "kernel.validation.exclusiveMinimum" },
  { keyword: "exclusiveMaximum", code: "kernel.validation.exclusiveMaximum" },
  { keyword: "multipleOf", code: "kernel.validation.multipleOf" },
  { keyword: "pattern", code: "kernel.validation.pattern" },
  { keyword: "format", code: "kernel.validation.format" },
  { keyword: "enum", code: "kernel.validation.enum" },
  { keyword: "const", code: "kernel.validation.const" },
  { keyword: "minItems", code: "kernel.validation.minItems" },
  { keyword: "maxItems", code: "kernel.validation.maxItems" },
  { keyword: "additionalItems", code: "kernel.validation.additionalItems" },
  { keyword: "uniqueItems", code: "kernel.validation.uniqueItems" },
  { keyword: "minProperties", code: "kernel.validation.minProperties" },
  { keyword: "maxProperties", code: "kernel.validation.maxProperties" },
  { keyword: "additionalProperties", code: "kernel.validation.additionalProperties" },
  { keyword: "propertyNames", code: "kernel.validation.propertyNames" },
  { keyword: "oneOf", code: "kernel.validation.oneOf" },
  { keyword: "anyOf", code: "kernel.validation.anyOf" },
  { keyword: "not", code: "kernel.validation.not" },
  { keyword: "if", code: "kernel.validation.if" }
].map(({ keyword, code }) => [keyword, code]));

// { code, params } for one Ajv issue, or null when its sentence has no code.
function resolveValidationIssueCode(issue = {}) {
  const code = VALIDATION_ISSUE_CODES.get(issue?.keyword);
  if (!code) {
    return null;
  }

  const params = isRecord(issue.params) ? { ...issue.params } : {};
  // Ajv writes a type list as "string,null"; a string param renders the same everywhere.
  if (Array.isArray(params.type)) {
    params.type = params.type.join(",");
  }
  return { code, params };
}

export { resolveValidationIssueCode };
