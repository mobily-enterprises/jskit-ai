import {
  normalizeSingleSchemaDefinition
} from "../validators/index.js";
import { isRecord as isPlainObject, normalizePositiveInteger } from "../support/normalize.js";
import { normalizePermissionList } from "../support/permissions.js";
import { normalizeText } from "./textNormalization.js";

const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_IDEMPOTENCY_POLICIES = Object.freeze(["none", "optional", "required", "domain_native"]);
const ACTION_PERMISSION_REQUIRE_MODES = Object.freeze(["none", "authenticated", "all", "any"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_IDEMPOTENCY_SET = new Set(ACTION_IDEMPOTENCY_POLICIES);
const ACTION_PERMISSION_REQUIRE_SET = new Set(ACTION_PERMISSION_REQUIRE_MODES);
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

function normalizeSingleActionSchema(value, fieldName, { required = false, defaultMode = "" } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (!isPlainObject(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be a json-rest-schema schema definition.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  try {
    return normalizeSingleSchemaDefinition(value, {
      context: `Action definition ${fieldName}`,
      defaultMode
    });
  } catch (error) {
    throw createActionRuntimeError(500, error?.message || `Action definition ${fieldName} is invalid.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }
}

function normalizeActionInputDefinition(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Array.isArray(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be a single schema definition.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return normalizeSingleActionSchema(value, fieldName, {
    required,
    defaultMode: "patch"
  });
}

function normalizeActionOutputDefinition(value, fieldName, { required = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw createActionRuntimeError(500, `Action definition ${fieldName} is required.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  if (Array.isArray(value)) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must be a single schema definition.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return normalizeSingleActionSchema(value, fieldName, {
    required,
    defaultMode: "replace"
  });
}

function normalizeActionPermission(permission, actionId) {
  if (permission == null) {
    return Object.freeze({
      require: "none",
      permissions: Object.freeze([]),
      message: "",
      code: ""
    });
  }

  if (!isPlainObject(permission)) {
    throw createActionRuntimeError(
      500,
      `Action definition \"${actionId}\" permission must be an object when provided.`,
      {
        code: "ACTION_DEFINITION_INVALID"
      }
    );
  }

  const requireMode = normalizeText(permission.require || "authenticated").toLowerCase();
  if (!ACTION_PERMISSION_REQUIRE_SET.has(requireMode)) {
    throw createActionRuntimeError(
      500,
      `Action definition \"${actionId}\" permission.require must be one of: ${ACTION_PERMISSION_REQUIRE_MODES.join(", ")}.`,
      {
        code: "ACTION_DEFINITION_INVALID"
      }
    );
  }

  return Object.freeze({
    require: requireMode,
    permissions: Object.freeze(normalizePermissionList(permission.permissions)),
    message: normalizeText(permission.message),
    code: normalizeText(permission.code)
  });
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

function normalizeActionExtensions(value) {
  if (value == null) {
    return Object.freeze({});
  }

  if (!isPlainObject(value)) {
    throw createActionRuntimeError(500, "Action definition extensions must be an object when provided.", {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return Object.freeze({
    ...value
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

  const version = normalizePositiveInteger(source.version, {
    fallback: 1
  });
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
    fieldName: "channels"
  });

  const surfaces = normalizeStringArray(source.surfaces, {
    fieldName: "surfaces"
  });

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
    input: normalizeActionInputDefinition(source.input, "input", {
      required: true
    }),
    output: normalizeActionOutputDefinition(source.output, "output", {
      required: false
    }),
    idempotency,
    permission: normalizeActionPermission(source.permission, id),
    audit: normalizeAuditConfig(source.audit, {
      actionId: id
    }),
    observability: normalizeObservabilityConfig(source.observability),
    extensions: normalizeActionExtensions(source.extensions),
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
  return `${normalizeText(actionId)}@v${normalizePositiveInteger(version, { fallback: 1 })}`;
}

const __testables = {
  normalizeText,
  isPlainObject,
  normalizeStringArray,
  normalizeSingleActionSchema,
  normalizeActionInputDefinition,
  normalizeActionOutputDefinition,
  normalizeActionPermission,
  normalizeAuditConfig,
  normalizeObservabilityConfig,
  normalizeActionExtensions
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
