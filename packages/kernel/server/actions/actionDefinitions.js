import { normalizeSingleSchemaDefinition } from "../../shared/validators/index.js";
import { isRecord as isPlainObject, normalizePositiveInteger, normalizeText } from "../../shared/support/normalize.js";
import { normalizePermissionList } from "../../shared/support/permissions.js";
import { ARCHITECTURE_ID_PATTERN } from "../../shared/capabilities/defineProvider.js";

const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_IDEMPOTENCY_POLICIES = Object.freeze(["none", "optional", "required", "domain_native"]);
const ACTION_PERMISSION_REQUIRE_MODES = Object.freeze(["none", "authenticated", "all", "any"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_IDEMPOTENCY_SET = new Set(ACTION_IDEMPOTENCY_POLICIES);
const ACTION_PERMISSION_REQUIRE_SET = new Set(ACTION_PERMISSION_REQUIRE_MODES);

class ActionRuntimeError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "ActionRuntimeError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = String(options.code || "ACTION_RUNTIME_ERROR");
    this.params = options.params && typeof options.params === "object" ? { ...options.params } : {};
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
  if (!ARCHITECTURE_ID_PATTERN.test(domain)) {
    throw createActionRuntimeError(
      500,
      `${context} must match ${ARCHITECTURE_ID_PATTERN.toString()} (lowercase letters, digits, _, -, .).`,
      {
        code: errorCode
      }
    );
  }

  return domain;
}

function normalizeStringArray(value, fieldName) {
  const source = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(source.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))
  );

  if (normalized.length < 1) {
    throw createActionRuntimeError(500, `Action definition ${fieldName} must include at least one value.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }

  return normalized;
}

function normalizeActionSchema(value, fieldName, { required = false, defaultMode = "" } = {}) {
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

function normalizeActionEvents(value, actionId) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw createActionRuntimeError(500, `Action definition "${actionId}" events must be an array.`, {
      code: "ACTION_DEFINITION_INVALID"
    });
  }
  return Object.freeze(value.map((builder, index) => {
    if (typeof builder !== "function") {
      throw createActionRuntimeError(
        500,
        `Action definition "${actionId}" events[${index}] must be a function.`,
        { code: "ACTION_DEFINITION_INVALID" }
      );
    }
    return builder;
  }));
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

  const channels = normalizeStringArray(source.channels, "channels");
  const surfaces = normalizeStringArray(source.surfaces, "surfaces");

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
    input: normalizeActionSchema(source.input, "input", {
      required: true,
      defaultMode: "patch"
    }),
    output: normalizeActionSchema(source.output, "output", {
      defaultMode: "replace"
    }),
    idempotency,
    permission: normalizeActionPermission(source.permission, id),
    extensions: normalizeActionExtensions(source.extensions),
    events: normalizeActionEvents(source.events, id),
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
  normalizeActionSchema,
  normalizeActionExtensions
};

export {
  ActionRuntimeError,
  createActionRuntimeError,
  normalizeActionDefinition,
  normalizeActionContributor,
  createActionVersionKey,
  __testables
};
