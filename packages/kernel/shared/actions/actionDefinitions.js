import { mergeValidators } from "../validators/mergeValidators.js";
import { normalizeText } from "./textNormalization.js";

const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_IDEMPOTENCY_POLICIES = Object.freeze(["none", "optional", "required", "domain_native"]);
const ACTION_CHANNELS = Object.freeze(["api", "assistant_tool", "assistant_chat", "internal", "worker"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_IDEMPOTENCY_SET = new Set(ACTION_IDEMPOTENCY_POLICIES);
const ACTION_CHANNEL_SET = new Set(ACTION_CHANNELS);
const ACTION_DOMAIN_PATTERN = /^[a-z][a-z0-9_.-]*$/;

class ActionRuntimeError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "ActionRuntimeError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = String(options.code || "ACTION_RUNTIME_ERROR");
    this.details = options.details;
    this.headers = options.headers || {};
    this.cause = options.cause;
  }
}

function createActionRuntimeError(status, message, options = {}) {
  return new ActionRuntimeError(status, message, options);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeActionDomain(value, { context = "domain", errorCode = "ACTION_DEFINITION_INVALID" } = {}) {
  const domain = normalizeText(value).toLowerCase();
  if (!domain) {
    throw createActionRuntimeError(500, `${context} is required.`, {
      code: errorCode
    });
  }
  if (!ACTION_DOMAIN_PATTERN.test(domain)) {
    throw createActionRuntimeError(
      500,
      `${context} must match ${ACTION_DOMAIN_PATTERN.toString()} (lowercase letters, digits, _, -, .).`,
      {
        code: errorCode
      }
    );
  }

  return domain;
}

function normalizeStringArray(value, { fieldName, allowedSet, allowEmpty = false } = {}) {
  const source = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(
      source
        .map((entry) => normalizeText(entry).toLowerCase())
        .filter(Boolean)
        .filter((entry) => {
          if (!(allowedSet instanceof Set)) {
            return true;
          }
          return allowedSet.has(entry);
        })
    )
  );

  if (!allowEmpty && normalized.length < 1) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must include at least one value.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return normalized;
}

function normalizeSingleActionValidator(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (!isPlainObject(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be an object.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (!Object.prototype.hasOwnProperty.call(value, "schema")) {
    throw createActionRuntimeError(500, `Action definition ${fieldName}.schema is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (
    value.schema == null ||
    (typeof value.schema !== "function" && (typeof value.schema !== "object" || Array.isArray(value.schema)))
  ) {
    throw createActionRuntimeError(500, `Action definition ${fieldName}.schema must be a function or object.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Object.prototype.hasOwnProperty.call(value, "normalize")) {
    if (value.normalize != null && typeof value.normalize !== "function") {
      throw createActionRuntimeError(500, `Action definition ${fieldName}.normalize must be a function.`, {
        code: "ACTION_DEFINITION_INVALID"
      });
    }
  }

  return Object.freeze({
    schema: value.schema,
    ...(typeof value.normalize === "function" ? { normalize: value.normalize } : {})
  });
}

function mergeNormalizedActionValidators(validators, fieldName) {
  return mergeValidators(validators, {
    context: `Action definition ${fieldName}`,
    requireSchema: true,
    requiredSchemaMessage: `Action definition ${fieldName}.schema is required.`,
    normalizeResultMessage: `Action definition ${fieldName}.normalize must return an object.`,
    createError(message) {
      return createActionRuntimeError(500, message, {
        code: "ACTION_DEFINITION_INVALID"
      });
    }
  });
}

function normalizeActionValidators(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const validatorsSource = Array.isArray(value) ? value : [value];

  if (validatorsSource.length < 1) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const validators = validatorsSource.map((entry, index) => {
    const validator = normalizeSingleActionValidator(entry, `${fieldName}[${index}]`, {
      required: true
    });

    if (!validator) {
      throw createActionRuntimeError(500, `Action definition ${fieldName}[${index}] is required.`, {
        code: "ACTION_DEFINITION_INVALID"
      });
    }

    return validator;
  });

  return mergeNormalizedActionValidators(validators, fieldName);
}

function normalizeActionOutputValidator(value, fieldName, { required = false } = {}) {
  return normalizeSingleActionValidator(value, fieldName, {
    required
  });
}

function normalizePermissionPolicy(permission) {
  if (typeof permission === "function") {
    return permission;
  }

  const permissions = normalizeStringArray(permission, {
    fieldName: "permission",
    allowEmpty: false
  });

  return Object.freeze(permissions);
}

function normalizeAuditConfig(audit, { actionId }) {
  const source = audit && typeof audit === "object" ? audit : {};
  const actionName = normalizeText(source.actionName || actionId);
  const metadataBuilder = source.metadataBuilder;
  const piiTags = normalizeStringArray(source.piiTags, {
    fieldName: "audit.piiTags",
    allowEmpty: true
  });

  if (metadataBuilder != null && typeof metadataBuilder !== "function") {
    throw createActionRuntimeError(500, "Action definition audit.metadataBuilder must be a function when provided.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return Object.freeze({
    actionName,
    metadataBuilder: typeof metadataBuilder === "function" ? metadataBuilder : null,
    piiTags
  });
}

function normalizeObservabilityConfig(observability) {
  const source = observability && typeof observability === "object" ? observability : {};
  const metricTags = normalizeStringArray(source.metricTags, {
    fieldName: "observability.metricTags",
    allowEmpty: true
  });
  const sampleRate = Number(source.sampleRate);

  return Object.freeze({
    metricTags,
    sampleRate: Number.isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 1 ? sampleRate : null
  });
}

function normalizeAssistantToolConfig(assistantTool) {
  if (assistantTool == null) {
    return null;
  }

  if (!isPlainObject(assistantTool)) {
    throw createActionRuntimeError(500, "Action definition assistantTool must be an object when provided.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const description = normalizeText(assistantTool.description);
  if (Object.prototype.hasOwnProperty.call(assistantTool, "input")) {
    throw createActionRuntimeError(500, "Action definition assistantTool.input is not supported. Use assistantTool.inputValidator.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const inputValidator = assistantTool.inputValidator;
  const assistantToolInputValidator =
    typeof inputValidator === "undefined"
      ? null
      : normalizeSingleActionValidator(inputValidator, "assistantTool.inputValidator");
  if (typeof assistantTool.inputJsonSchema !== "undefined") {
    throw createActionRuntimeError(500, "Action definition assistantTool.inputJsonSchema is not supported. Use assistantTool.inputValidator.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return Object.freeze({
    description,
    inputValidator: assistantToolInputValidator,
    inputJsonSchema: assistantToolInputValidator?.schema || null
  });
}

function normalizeActionDefinition(definition, { contributorId = "", contributorDomain = "" } = {}) {
  const source = definition && typeof definition === "object" ? definition : {};

  const id = normalizeText(source.id);
  if (!id) {
    throw createActionRuntimeError(500, "Action definition id is required.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const version = normalizePositiveInteger(source.version, 1);
  const domain = normalizeActionDomain(source.domain || contributorDomain, {
    context: `Action definition \"${id}\" domain`,
    errorCode: "ACTION_DEFINITION_INVALID"
  });

  const kind = normalizeText(source.kind || "command").toLowerCase();
  if (!ACTION_KIND_SET.has(kind)) {
    throw createActionRuntimeError(500, `Action definition \"${id}\" has unsupported kind \"${kind}\".`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const channels = normalizeStringArray(source.channels, {
    fieldName: "channels",
    allowedSet: ACTION_CHANNEL_SET
  });

  const surfaces = normalizeStringArray(source.surfaces, {
    fieldName: "surfaces"
  });

  if (Object.prototype.hasOwnProperty.call(source, "visibility")) {
    throw createActionRuntimeError(500, `Action definition \"${id}\" must use consoleUsersOnly instead of visibility.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Object.prototype.hasOwnProperty.call(source, "consoleUsersOnly") && typeof source.consoleUsersOnly !== "boolean") {
    throw createActionRuntimeError(500, `Action definition \"${id}\" consoleUsersOnly must be a boolean.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const consoleUsersOnly = source.consoleUsersOnly === true;

  const idempotency = normalizeText(source.idempotency || "none").toLowerCase();
  if (!ACTION_IDEMPOTENCY_SET.has(idempotency)) {
    throw createActionRuntimeError(
      500,
      `Action definition \"${id}\" has unsupported idempotency policy \"${idempotency}\".`,
      {
        code: "ACTION_DEFINITION_INVALID"
      }
    );
  }

  if (typeof source.execute !== "function") {
    throw createActionRuntimeError(500, `Action definition \"${id}\" execute handler is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Object.prototype.hasOwnProperty.call(source, "input")) {
    throw createActionRuntimeError(500, `Action definition \"${id}\" must use inputValidator instead of input.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Object.prototype.hasOwnProperty.call(source, "output")) {
    throw createActionRuntimeError(500, `Action definition \"${id}\" must use outputValidator instead of output.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return Object.freeze({
    id,
    version,
    domain,
    kind,
    channels,
    surfaces,
    consoleUsersOnly,
    inputValidator: normalizeActionValidators(source.inputValidator, "inputValidator", {
      required: true
    }),
    outputValidator: normalizeActionOutputValidator(source.outputValidator, "outputValidator", {
      required: false
    }),
    permission: normalizePermissionPolicy(source.permission),
    idempotency,
    audit: normalizeAuditConfig(source.audit, {
      actionId: id
    }),
    observability: normalizeObservabilityConfig(source.observability),
    assistantTool: normalizeAssistantToolConfig(source.assistantTool),
    execute: source.execute,
    contributorId: normalizeText(contributorId)
  });
}

function normalizeActionContributor(contributor) {
  const source = contributor && typeof contributor === "object" ? contributor : {};
  const contributorId = normalizeText(source.contributorId);
  if (!contributorId) {
    throw createActionRuntimeError(500, "Action contributor contributorId is required.", {
      code: "ACTION_CONTRIBUTOR_INVALID"
    });
  }

  const domain = normalizeActionDomain(source.domain, {
    context: `Action contributor \"${contributorId}\" domain`,
    errorCode: "ACTION_CONTRIBUTOR_INVALID"
  });

  const sourceActions = Array.isArray(source.actions) ? source.actions : [];
  const actions = sourceActions.map((entry) =>
    normalizeActionDefinition(entry, {
      contributorId,
      contributorDomain: domain
    })
  );

  return Object.freeze({
    contributorId,
    domain,
    actions: Object.freeze(actions)
  });
}

function createActionVersionKey(actionId, version) {
  return `${normalizeText(actionId)}@v${normalizePositiveInteger(version, 1)}`;
}

const __testables = {
  normalizeText,
  isPlainObject,
  normalizePositiveInteger,
  normalizeStringArray,
  normalizeSingleActionValidator,
  normalizeActionValidators,
  normalizeActionOutputValidator,
  normalizePermissionPolicy,
  normalizeAuditConfig,
  normalizeObservabilityConfig,
  normalizeAssistantToolConfig
};

export {
  ActionRuntimeError,
  createActionRuntimeError,
  normalizeActionDefinition,
  normalizeActionContributor,
  normalizeActionDomain,
  createActionVersionKey,
  isPlainObject,
  __testables
};
