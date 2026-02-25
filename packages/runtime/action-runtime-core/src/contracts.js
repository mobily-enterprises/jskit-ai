const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_VISIBILITY_LEVELS = Object.freeze(["public", "internal", "operator"]);
const ACTION_IDEMPOTENCY_POLICIES = Object.freeze(["none", "optional", "required", "domain_native"]);
const ACTION_DOMAINS = Object.freeze([
  "auth",
  "settings",
  "workspace",
  "projects",
  "chat",
  "billing",
  "console",
  "assistant",
  "deg2rad_history"
]);
const ACTION_CHANNELS = Object.freeze(["api", "assistant_tool", "assistant_chat", "internal", "worker"]);
const ACTION_SURFACES = Object.freeze(["app", "admin", "console"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_VISIBILITY_SET = new Set(ACTION_VISIBILITY_LEVELS);
const ACTION_IDEMPOTENCY_SET = new Set(ACTION_IDEMPOTENCY_POLICIES);
const ACTION_DOMAIN_SET = new Set(ACTION_DOMAINS);
const ACTION_CHANNEL_SET = new Set(ACTION_CHANNELS);
const ACTION_SURFACE_SET = new Set(ACTION_SURFACES);

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

function normalizeText(value) {
  return String(value || "").trim();
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

function isSchemaContract(value) {
  if (!value) {
    return false;
  }
  if (typeof value === "function") {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }

  return (
    typeof value.parse === "function" ||
    typeof value.validate === "function" ||
    typeof value.assert === "function" ||
    typeof value.check === "function"
  );
}

function normalizeSchemaContract(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (!isSchemaContract(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be a schema contract.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return value;
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
    fieldName: "surfaces",
    allowedSet: ACTION_SURFACE_SET
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
    inputSchema: normalizeSchemaContract(source.inputSchema, "inputSchema", {
      required: true
    }),
    outputSchema: normalizeSchemaContract(source.outputSchema, "outputSchema", {
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
  isSchemaContract,
  normalizeSchemaContract,
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
  __testables
};
