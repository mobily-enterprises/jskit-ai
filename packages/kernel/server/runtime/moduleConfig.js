import { deepFreeze } from "../../shared/support/deepFreeze.js";
import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { validateSchemaPayload } from "../../shared/validators/schemaPayloadValidation.js";

function normalizeModuleId(value) {
  const moduleId = normalizeText(value);
  if (!moduleId) {
    throw new TypeError("defineModuleConfig requires a non-empty moduleId.");
  }
  return moduleId;
}

function normalizeSchema(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("defineModuleConfig requires a schema object.");
  }
  return value;
}

function normalizeIssuePath(issue) {
  const fromInstancePath = normalizeText(issue?.instancePath || issue?.path).replace(/^\//, "").replace(/\//g, ".");
  if (fromInstancePath) {
    return fromInstancePath;
  }

  const missingProperty = normalizeText(issue?.params?.missingProperty);
  if (missingProperty) {
    return missingProperty;
  }

  const additionalProperties = issue?.params?.additionalProperties;
  if (Array.isArray(additionalProperties) && additionalProperties.length > 0) {
    const firstAdditional = normalizeText(additionalProperties[0]);
    if (firstAdditional) {
      return firstAdditional;
    }
  }

  const oneAdditional = normalizeText(additionalProperties);
  if (oneAdditional) {
    return oneAdditional;
  }

  return "(root)";
}

function normalizeIssueMessage(issue) {
  const message = normalizeText(issue?.message || issue?.error || issue?.description);
  return message || "Invalid value.";
}

function normalizeValidationIssues(rawIssues = []) {
  return rawIssues.map((issue) => ({
    path: normalizeIssuePath(issue),
    message: normalizeIssueMessage(issue),
    keyword: normalizeText(issue?.keyword)
  }));
}

function formatIssues(issues = []) {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");
}

function buildInvalidConfigMessage(moduleId, issues = []) {
  const summary = formatIssues(issues);
  if (!summary) {
    return `Invalid config for module "${moduleId}".`;
  }
  return `Invalid config for module "${moduleId}": ${summary}`;
}

function normalizeCustomValidationIssues(result) {
  if (result == null || result === true) {
    return [];
  }

  if (result === false) {
    return [
      {
        path: "(custom)",
        message: "Custom module config validation failed."
      }
    ];
  }

  if (typeof result === "string") {
    return [
      {
        path: "(custom)",
        message: normalizeText(result) || "Custom module config validation failed."
      }
    ];
  }

  if (Array.isArray(result)) {
    return result
      .map((entry) => {
        if (typeof entry === "string") {
          return {
            path: "(custom)",
            message: normalizeText(entry) || "Custom module config validation failed."
          };
        }

        if (!entry || typeof entry !== "object") {
          return null;
        }

        return {
          path: normalizeText(entry.path, { fallback: "(custom)" }),
          message: normalizeText(entry.message, { fallback: "Custom module config validation failed." })
        };
      })
      .filter(Boolean);
  }

  if (result && typeof result === "object" && Array.isArray(result.issues)) {
    return normalizeCustomValidationIssues(result.issues);
  }

  return [
    {
      path: "(custom)",
      message: "Custom module config validation failed."
    }
  ];
}

class ModuleConfigError extends Error {
  constructor(message, { moduleId = "", issues = [], cause } = {}) {
    super(String(message || "Module config error."));
    this.name = "ModuleConfigError";
    this.moduleId = normalizeText(moduleId);
    this.issues = Object.freeze(Array.isArray(issues) ? [...issues] : []);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function validateSchemaOrThrow({ moduleId, schema, value, coerce = false }) {
  const schemaDefinition = {
    schema,
    mode: "replace"
  };

  try {
    return validateSchemaPayload(schemaDefinition, value, {
      phase: "input",
      context: `module config "${moduleId}"`
    });
  } catch (cause) {
    const fieldErrors = normalizeObject(cause?.fieldErrors);
    const issues = Object.keys(fieldErrors).length > 0
      ? Object.keys(fieldErrors).map((path) => ({
          path,
          message: normalizeText(fieldErrors[path], { fallback: "Invalid value." }),
          keyword: ""
        }))
      : [
          {
            path: "(root)",
            message: normalizeText(cause?.message, { fallback: "Invalid value." }),
            keyword: ""
          }
        ];

    throw new ModuleConfigError(buildInvalidConfigMessage(moduleId, issues), {
      moduleId,
      issues,
      cause
    });
  }
}

function defineModuleConfig({
  moduleId,
  schema,
  load = ({ env }) => env,
  transform = null,
  validate = null,
  coerce = false,
  freeze = true
} = {}) {
  const normalizedModuleId = normalizeModuleId(moduleId);
  const normalizedSchema = normalizeSchema(schema);

  if (typeof load !== "function") {
    throw new TypeError(`defineModuleConfig("${normalizedModuleId}") requires load to be a function.`);
  }
  if (transform != null && typeof transform !== "function") {
    throw new TypeError(`defineModuleConfig("${normalizedModuleId}") requires transform to be a function when provided.`);
  }
  if (validate != null && typeof validate !== "function") {
    throw new TypeError(`defineModuleConfig("${normalizedModuleId}") requires validate to be a function when provided.`);
  }

  function resolve(options = {}) {
    const source = normalizeObject(options);
    const env = source.env && typeof source.env === "object" ? source.env : process.env;
    const context = source.context;
    const hasRaw = Object.prototype.hasOwnProperty.call(source, "raw");

    let loadedConfig;
    try {
      loadedConfig = hasRaw ? source.raw : load({ env, context, moduleId: normalizedModuleId });
    } catch (cause) {
      throw new ModuleConfigError(`Failed to load config for module "${normalizedModuleId}".`, {
        moduleId: normalizedModuleId,
        cause
      });
    }

    let candidate = loadedConfig;
    if (typeof transform === "function") {
      candidate = transform(candidate, { env, context, moduleId: normalizedModuleId });
    }

    let resolvedConfig = validateSchemaOrThrow({
      moduleId: normalizedModuleId,
      schema: normalizedSchema,
      value: candidate,
      coerce: Boolean(coerce)
    });

    if (typeof validate === "function") {
      let customValidationResult;
      try {
        customValidationResult = validate(resolvedConfig, { env, context, moduleId: normalizedModuleId });
      } catch (cause) {
        throw new ModuleConfigError(`Invalid config for module "${normalizedModuleId}" from custom validation.`, {
          moduleId: normalizedModuleId,
          cause
        });
      }

      const issues = normalizeCustomValidationIssues(customValidationResult);
      if (issues.length > 0) {
        throw new ModuleConfigError(buildInvalidConfigMessage(normalizedModuleId, issues), {
          moduleId: normalizedModuleId,
          issues
        });
      }
    }

    if (freeze) {
      resolvedConfig = deepFreeze(resolvedConfig);
    }

    return resolvedConfig;
  }

  return Object.freeze({
    moduleId: normalizedModuleId,
    schema: normalizedSchema,
    resolve
  });
}

export { ModuleConfigError, defineModuleConfig };
