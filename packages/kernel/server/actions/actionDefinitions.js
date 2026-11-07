import { normalizeSingleSchemaDefinition } from "../../shared/validators/index.js";
import { isRecord as isPlainObject, normalizePositiveInteger, normalizeText } from "../../shared/support/normalize.js";
import { normalizePermissionList } from "../../shared/support/permissions.js";
import { ARCHITECTURE_ID_PATTERN } from "../../shared/capabilities/defineProvider.js";

/** @typedef {import("../types.js").ActionDefinition} ActionDefinition */
/** @typedef {import("../types.js").ActionPolicy} ActionPolicy */

const ACTION_KINDS = Object.freeze(["query", "command", "stream"]);
const ACTION_PERMISSION_REQUIRE_MODES = Object.freeze(["none", "authenticated", "all", "any"]);

const ACTION_KIND_SET = new Set(ACTION_KINDS);
const ACTION_PERMISSION_REQUIRE_SET = new Set(ACTION_PERMISSION_REQUIRE_MODES);
/**
 * The mode of an action input that declares none: create, so the schema's
 * required fields are enforced and its defaults applied. Only an action that
 * updates part of a record declares `mode: "patch"`.
 */
const ACTION_INPUT_DEFAULT_MODE = "create";
const ACTION_INPUT_SCHEMA_OPTIONS = Object.freeze({
  required: true,
  defaultMode: ACTION_INPUT_DEFAULT_MODE,
  refuseOneOf: true
});

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

function normalizeActionDomain(value, { context = "domain" } = {}) {
  const domain = normalizeText(value).toLowerCase();
  if (!domain) {
    throw new Error(`${context} is required.`);
  }
  if (!ARCHITECTURE_ID_PATTERN.test(domain)) {
    throw new Error(`${context} must match ${ARCHITECTURE_ID_PATTERN.toString()} (lowercase letters, digits, _, -, .).`);
  }

  return domain;
}

function normalizeStringArray(value, fieldName) {
  const source = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(source.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))
  );

  if (normalized.length < 1) {
    throw new Error(`Action definition ${fieldName} must include at least one value.`);
  }

  return normalized;
}

/** The field definitions of a json-rest-schema instance, or null for anything else. */
function schemaFieldDefinitions(value) {
  // readable-check: allow method-probe - input validation: a field's schema, items or values is a json-rest-schema instance or a field definition
  return value && typeof value.getFieldDefinitions === "function" ? value.getFieldDefinitions() : null;
}

/**
 * json-rest-schema validates no `oneOf`; json-rest-api reads it as the fields a
 * search matches. On an action input it would pass for a list of allowed values
 * while allowing any, so an input field that declares it, at any depth (a nested
 * schema, array items, object values), is refused.
 */
function refuseOneOfFields(fields, fieldName, parentPath = "") {
  for (const [name, definition] of Object.entries(fields)) {
    refuseOneOfField(definition, fieldName, parentPath ? `${parentPath}.${name}` : name);
  }
}

/** One field definition, or the schema instance a field's items or values give. */
function refuseOneOfField(definition, fieldName, path) {
  const fields = schemaFieldDefinitions(definition);
  if (fields) {
    refuseOneOfFields(fields, fieldName, path);
    return;
  }
  if (!isPlainObject(definition)) {
    return;
  }
  if (Object.hasOwn(definition, "oneOf")) {
    throw new Error(
      `Action definition ${fieldName} field "${path}" declares oneOf, which does not restrict its value; list the allowed values with enum.`
    );
  }
  refuseOneOfFields(schemaFieldDefinitions(definition.schema) || {}, fieldName, path);
  if (Object.hasOwn(definition, "items")) {
    refuseOneOfField(definition.items, fieldName, `${path}[]`);
  }
  if (Object.hasOwn(definition, "values")) {
    refuseOneOfField(definition.values, fieldName, `${path}.*`);
  }
}

function normalizeActionSchema(value, fieldName, { required = false, defaultMode = "", refuseOneOf = false } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw new Error(`Action definition ${fieldName} is required.`);
  }

  if (Array.isArray(value)) {
    throw new Error(`Action definition ${fieldName} must be a single schema definition.`);
  }

  if (!isPlainObject(value)) {
    throw new Error(`Action definition ${fieldName} must be a json-rest-schema schema definition.`);
  }

  let definition;
  try {
    definition = normalizeSingleSchemaDefinition(value, {
      context: `Action definition ${fieldName}`,
      defaultMode
    });
  } catch (error) {
    throw new Error(error?.message || `Action definition ${fieldName} is invalid.`);
  }

  if (refuseOneOf) {
    refuseOneOfFields(schemaFieldDefinitions(definition.schema) || {}, fieldName);
  }
  return definition;
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
    throw new Error(`Action definition \"${actionId}\" permission must be an object when provided.`);
  }

  const requireMode = normalizeText(permission.require || "authenticated").toLowerCase();
  if (!ACTION_PERMISSION_REQUIRE_SET.has(requireMode)) {
    throw new Error(`Action definition \"${actionId}\" permission.require must be one of: ${ACTION_PERMISSION_REQUIRE_MODES.join(", ")}.`);
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
    throw new Error("Action definition extensions must be an object when provided.");
  }

  return Object.freeze({
    ...value
  });
}

function normalizeActionEvents(value, actionId) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new Error(`Action definition "${actionId}" events must be an array.`);
  }
  return Object.freeze(value.map((builder, index) => {
    // readable-check: allow method-probe - input validation: each of an action definition's event builders must be a function
    if (typeof builder !== "function") {
      throw new Error(`Action definition "${actionId}" events[${index}] must be a function.`);
    }
    return builder;
  }));
}

function normalizeActionDefinition(definition, { contributorId = "", contributorDomain = "" } = {}) {
  const source = definition && typeof definition === "object" ? definition : {};

  const id = normalizeText(source.id);
  if (!id) {
    throw new Error("Action definition id is required.");
  }

  const version = normalizePositiveInteger(source.version, {
    fallback: 1
  });
  const domain = normalizeActionDomain(source.domain || contributorDomain, {
    context: `Action definition \"${id}\" domain`
  });

  const kind = normalizeText(source.kind || "command").toLowerCase();
  if (!ACTION_KIND_SET.has(kind)) {
    throw new Error(`Action definition \"${id}\" has unsupported kind \"${kind}\".`);
  }

  const channels = normalizeStringArray(source.channels, "channels");
  const surfaces = normalizeStringArray(source.surfaces, "surfaces");

  if (Object.hasOwn(source, "idempotency")) {
    throw new Error(`Action definition \"${id}\" declares idempotency. Action definitions no longer declare idempotency.`);
  }

  // readable-check: allow method-probe - input validation: an application's action definition must have execute()
  if (typeof source.execute !== "function") {
    throw new Error(`Action definition \"${id}\" execute handler is required.`);
  }

  return Object.freeze({
    id,
    version,
    domain,
    kind,
    channels,
    surfaces,
    input: normalizeActionSchema(source.input, "input", ACTION_INPUT_SCHEMA_OPTIONS),
    output: normalizeActionSchema(source.output, "output", {
      defaultMode: "replace"
    }),
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
    throw new Error("Action contributor contributorId is required.");
  }

  const domain = normalizeActionDomain(source.domain, {
    context: `Action contributor \"${contributorId}\" domain`
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

/**
 * The definition an action is registered with: as declared, with the input the
 * policy returns, checked like a declared input.
 * @param {ActionDefinition} declared
 * @param {ActionPolicy} policy
 */
function withPolicyInput(declared, policy) {
  const input = policy.input(declared);
  if (input === declared.input) {
    return declared;
  }

  return Object.freeze({
    ...declared,
    input: normalizeActionSchema(input, "input", ACTION_INPUT_SCHEMA_OPTIONS)
  });
}

/**
 * A contributor as the catalogue registers it, once: each action normalized as
 * its feature declared it, and the definition it is registered with.
 * @param {object} contributor
 * @param {ActionPolicy} policy
 */
function toRegisteredContributor(contributor, policy) {
  const { contributorId, domain, actions } = normalizeActionContributor(contributor);
  return Object.freeze({
    contributorId,
    domain,
    actions: Object.freeze(actions.map((declared) => Object.freeze({
      declared,
      definition: withPolicyInput(declared, policy)
    })))
  });
}

function toActionVersionKey(actionId, version) {
  return `${normalizeText(actionId)}@v${normalizePositiveInteger(version, { fallback: 1 })}`;
}

const __testables = {
  normalizeActionSchema,
  normalizeActionExtensions
};

export {
  ACTION_INPUT_DEFAULT_MODE,
  ActionRuntimeError,
  normalizeActionDefinition,
  toRegisteredContributor,
  toActionVersionKey,
  __testables
};
