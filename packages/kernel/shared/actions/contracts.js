import { mergeObjectSchemas } from "../contracts/mergeObjectSchemas.js";
import { normalizeText } from "./textNormalization.js";

const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_VISIBILITY_LEVELS = Object.freeze(["public", "internal", "operator"]);
const ACTION_IDEMPOTENCY_POLICIES = Object.freeze(["none", "optional", "required", "domain_native"]);
const ACTION_DOMAINS = Object.freeze([
  "auth",
  "settings",
  "workspace",
  "projects",
  "chat",
  "social",
  "billing",
  "console",
  "assistant",
  "deg2rad_history"
]);
const ACTION_CHANNELS = Object.freeze(["api", "assistant_tool", "assistant_chat", "internal", "worker"]);
const ACTION_SURFACES = Object.freeze(["<dynamic-from-app-config>"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_VISIBILITY_SET = new Set(ACTION_VISIBILITY_LEVELS);
const ACTION_IDEMPOTENCY_SET = new Set(ACTION_IDEMPOTENCY_POLICIES);
const ACTION_DOMAIN_SET = new Set(ACTION_DOMAINS);
const ACTION_CHANNEL_SET = new Set(ACTION_CHANNELS);

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

function normalizeSingleActionContractPart(value, fieldName, { required = false } = {}) {
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

function mergeNormalizedActionContractParts(parts, fieldName) {
  const normalized = {};
  const schemas = [];
  const normalizers = [];

  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(part, "schema")) {
      schemas.push(part.schema);
    }
    if (typeof part.normalize === "function") {
      normalizers.push(part.normalize);
    }
  }

  if (schemas.length < 1) {
    throw createActionRuntimeError(500, `Action definition ${fieldName}.schema is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  normalized.schema = schemas.length === 1 ? schemas[0] : mergeObjectSchemas(schemas);

  if (normalizers.length === 1) {
    normalized.normalize = normalizers[0];
  } else if (normalizers.length > 1) {
    normalized.normalize = async function normalizeMergedActionContractParts(payload, meta) {
      const merged = {};

      for (const normalizer of normalizers) {
        const result = await normalizer(payload, meta);
        if (!isPlainObject(result)) {
          throw createActionRuntimeError(500, `Action definition ${fieldName}.normalize must return an object.`, {
            code: "ACTION_DEFINITION_INVALID"
          });
        }
        Object.assign(merged, result);
      }

      return merged;
    };
  }

  return Object.freeze(normalized);
}

function normalizeActionInputParts(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (!Array.isArray(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be an array.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (value.length < 1) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  const parts = value.map((entry, index) => {
    const part = normalizeSingleActionContractPart(entry, `${fieldName}[${index}]`, {
      required: true
    });

    if (!part) {
      throw createActionRuntimeError(500, `Action definition ${fieldName}[${index}] is required.`, {
        code: "ACTION_DEFINITION_INVALID"
      });
    }

    return part;
  });

  return mergeNormalizedActionContractParts(parts, fieldName);
}

function normalizeActionContractPart(value, fieldName, { required = false } = {}) {
  return normalizeSingleActionContractPart(value, fieldName, {
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
  const inputJsonSchema = assistantTool.inputJsonSchema;
  if (inputJsonSchema != null && !isPlainObject(inputJsonSchema)) {
    throw createActionRuntimeError(500, "Action definition assistantTool.inputJsonSchema must be an object.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return Object.freeze({
    description,
    inputJsonSchema: inputJsonSchema ? Object.freeze({ ...inputJsonSchema }) : null
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
  const domain = normalizeText(source.domain || contributorDomain).toLowerCase();
  if (!ACTION_DOMAIN_SET.has(domain)) {
    throw createActionRuntimeError(500, `Action definition \"${id}\" has unsupported domain \"${domain}\".`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

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

  const visibility = normalizeText(source.visibility || "public").toLowerCase();
  if (!ACTION_VISIBILITY_SET.has(visibility)) {
    throw createActionRuntimeError(
      500,
      `Action definition \"${id}\" has unsupported visibility \"${visibility}\".`,
      {
        code: "ACTION_DEFINITION_INVALID"
      }
    );
  }

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

  return Object.freeze({
    id,
    version,
    domain,
    kind,
    channels,
    surfaces,
    visibility,
    input: normalizeActionInputParts(source.input, "input", {
      required: true
    }),
    output: normalizeActionContractPart(source.output, "output", {
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

  const domain = normalizeText(source.domain).toLowerCase();
  if (!ACTION_DOMAIN_SET.has(domain)) {
    throw createActionRuntimeError(500, `Action contributor \"${contributorId}\" has unsupported domain \"${domain}\".`, {
      code: "ACTION_CONTRIBUTOR_INVALID"
    });
  }

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
  normalizeSingleActionContractPart,
  normalizeActionInputParts,
  normalizeActionContractPart,
  normalizePermissionPolicy,
  normalizeAuditConfig,
  normalizeObservabilityConfig,
  normalizeAssistantToolConfig
};

export {
  ACTION_KINDS,
  ACTION_VISIBILITY_LEVELS,
  ACTION_IDEMPOTENCY_POLICIES,
  ACTION_DOMAINS,
  ACTION_CHANNELS,
  ACTION_SURFACES,
  ActionRuntimeError,
  createActionRuntimeError,
  normalizeActionDefinition,
  normalizeActionContributor,
  createActionVersionKey,
  isPlainObject,
  __testables
};
