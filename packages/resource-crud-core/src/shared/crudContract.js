import {
  createSchema,
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { buildCrudOperationSchemaFields, normalizeCrudFieldOperations } from "./crudFieldContract.js";
import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createSchemaDefinition,
  defineApiContract,
  normalizeSchemaDefinitionLike
} from "@jskit-ai/resource-core/shared/apiContract";
import { isTableResource, storedTimestamps } from "@jskit-ai/resource-core/shared/tableResource";
import { resolveCrudRecordChangedEvent } from "./crudNamespaceSupport.js";

const DEFAULT_CRUD_OPERATION_NAMES = Object.freeze([
  "list",
  "view",
  "create",
  "patch",
  "delete"
]);

const SUPPORTED_CRUD_OPERATION_NAMES = Object.freeze([
  "list",
  "view",
  "create",
  "replace",
  "patch",
  "delete"
]);

// The output and body schemas a contract may give explicitly; any it leaves out are derived from its fields.
const SCHEMA_KEYS = Object.freeze([
  "output",
  "listOutput",
  "listItemOutput",
  "createBody",
  "body",
  "patchBody",
  "replaceBody",
  "deleteOutput"
]);

const CONTRACT_KEYS = new Set([
  "namespace",
  "apiAccess",
  "operations",
  "fields",
  "messages",
  "contract",
  ...SCHEMA_KEYS
]);

const CRUD_OPERATION_SPECS = Object.freeze({
  list: Object.freeze({
    method: "GET",
    outputKind: "list",
    includeRealtimeEvent: true
  }),
  view: Object.freeze({
    method: "GET",
    outputKind: "record"
  }),
  create: Object.freeze({
    method: "POST",
    outputKind: "record",
    bodyOperation: "create",
    bodyMode: "create",
    explicitBodyKeys: Object.freeze(["createBody", "body"])
  }),
  replace: Object.freeze({
    method: "PUT",
    outputKind: "record",
    bodyOperation: "replace",
    bodyMode: "replace",
    explicitBodyKeys: Object.freeze(["replaceBody", "body", "createBody"])
  }),
  patch: Object.freeze({
    method: "PATCH",
    outputKind: "record",
    bodyOperation: "patch",
    bodyMode: "patch",
    explicitBodyKeys: Object.freeze(["patchBody", "body"])
  }),
  delete: Object.freeze({
    method: "DELETE",
    outputKind: "delete"
  })
});

const crudContracts = new WeakSet();

function buildCrudRecordIdFieldDefinition() {
  return {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  };
}

/**
 * Only an explicitly configured container key adds a lookup field to the derived output;
 * unlike crudLookup.js resolveCrudLookupContainerKey, the default "lookups" key is not applied.
 * @param {Record<string, any>} config
 */
function resolveConfiguredLookupContainerKey(config) {
  return normalizeText(config.contract?.lookup?.containerKey);
}

function buildDerivedCrudRecordOutputDefinition(source) {
  const outputFields = buildCrudOperationSchemaFields(source.resource.schema, "output", source.fields);
  if (Object.keys(outputFields).length < 1) {
    throw new Error(
      "defineCrudContract derived output requires an explicit output or at least one field with an output operation."
    );
  }

  const fields = {
    id: buildCrudRecordIdFieldDefinition(),
    ...outputFields
  };
  const lookupContainerKey = resolveConfiguredLookupContainerKey(source.config);

  if (lookupContainerKey) {
    fields[lookupContainerKey] = {
      type: "object",
      required: false
    };
  }

  return createSchemaDefinition(createSchema(fields), "replace", {
    context: "defineCrudContract derived output"
  });
}

function buildDerivedCrudBodyDefinition(source, operationName = "patch", bodyMode = "patch") {
  let fields = buildCrudOperationSchemaFields(source.resource.schema, operationName, source.fields);

  if (operationName === "replace" && Object.keys(fields).length === 0) {
    fields = buildCrudOperationSchemaFields(source.resource.schema, "create", source.fields);
  }

  if (Object.keys(fields).length < 1) {
    const fieldHint = operationName === "replace"
      ? "a replace or create operation"
      : `a ${operationName} operation`;
    throw new Error(
      `defineCrudContract derived ${operationName} body requires an explicit ${operationName}Body or at least one field with ${fieldHint}.`
    );
  }

  return createSchemaDefinition(createSchema(fields), bodyMode, {
    context: `defineCrudContract derived ${operationName} body`
  });
}

function buildCrudDeleteOutputDefinition() {
  return createSchemaDefinition(createSchema({
    id: buildCrudRecordIdFieldDefinition(),
    deleted: {
      type: "boolean",
      required: true
    }
  }), "replace", {
    context: "defineCrudContract delete output"
  });
}

function requireCrudOperationName(value = "") {
  const normalizedName = normalizeText(value).toLowerCase();
  if (SUPPORTED_CRUD_OPERATION_NAMES.includes(normalizedName)) {
    return normalizedName;
  }
  throw new Error(
    `defineCrudContract operations must be among: ${SUPPORTED_CRUD_OPERATION_NAMES.join(", ")}. ` +
      `Received: ${JSON.stringify(value)}.`
  );
}

function resolveCrudOperationNames(operations) {
  if (operations !== undefined && !Array.isArray(operations)) {
    throw new TypeError("defineCrudContract operations must be an array of CRUD operation names.");
  }
  return [...new Set((operations ?? DEFAULT_CRUD_OPERATION_NAMES).map((name) => requireCrudOperationName(name)))];
}

function resolveFirstPresentValue(source = {}, keys = []) {
  for (const key of keys) {
    if (Object.hasOwn(source, key) && source[key] != null) {
      return source[key];
    }
  }
  return null;
}

function resolveExplicitCrudSchemaDefinition(config, keys, { context, defaultMode }) {
  const explicitValue = resolveFirstPresentValue(config, keys);
  if (explicitValue == null) {
    return null;
  }

  return normalizeSchemaDefinitionLike(explicitValue, {
    context,
    defaultMode
  });
}

function buildCrudListOutputDefinition(resolveRecordOutputDefinition, config) {
  const explicitListOutput = resolveExplicitCrudSchemaDefinition(config, ["listOutput"], {
    context: "defineCrudContract listOutput",
    defaultMode: "replace"
  });
  if (explicitListOutput) {
    return explicitListOutput;
  }

  const explicitListItemOutput = resolveExplicitCrudSchemaDefinition(config, ["listItemOutput"], {
    context: "defineCrudContract listItemOutput",
    defaultMode: "replace"
  });
  if (explicitListItemOutput) {
    return createCursorListValidator(
      explicitListItemOutput
    );
  }

  return createCursorListValidator(resolveRecordOutputDefinition());
}

function createCrudRecordOutputDefinitionResolver(source) {
  let cachedDefinition = null;
  let hasResolved = false;

  return function resolveRecordOutputDefinition() {
    if (hasResolved) {
      return cachedDefinition;
    }

    cachedDefinition = resolveExplicitCrudSchemaDefinition(source.config, ["output"], {
      context: "defineCrudContract output",
      defaultMode: "replace"
    }) || buildDerivedCrudRecordOutputDefinition(source);
    hasResolved = true;
    return cachedDefinition;
  };
}

/**
 * Refuses a request body that takes a stored timestamp: the handle stamps createdAt and updatedAt itself, and only a
 * system context may set them.
 * @param {string} resourceName
 * @param {string} where The contract entry, for the message.
 * @param {string} field
 */
function refuseStampedField(resourceName, where, field) {
  throw new TypeError(
    `defineCrudContract(${resourceName}) ${where} takes ${field}, which the handle stamps on every write: ` +
      "a request never sets it, so the contract offers it as output only. An import sets its own through a system context."
  );
}

function resolveCrudBodyDefinition(spec, source) {
  const explicitBody = resolveExplicitCrudSchemaDefinition(
    source.config,
    spec.explicitBodyKeys,
    {
      context: `defineCrudContract operations.${spec.bodyOperation}.body`,
      defaultMode: spec.bodyMode
    }
  );
  if (explicitBody) {
    const takes = Object.keys(explicitBody.schema.getFieldDefinitions());
    const stamped = storedTimestamps(source.resource.schema).find((field) => takes.includes(field));
    if (stamped) {
      refuseStampedField(source.resource.name, `${spec.bodyOperation} body`, stamped);
    }
    return explicitBody;
  }

  return buildDerivedCrudBodyDefinition(source, spec.bodyOperation, spec.bodyMode);
}

function resolveCrudOutputDefinition(spec, resolveRecordOutputDefinition, config) {
  if (spec.outputKind === "list") {
    return buildCrudListOutputDefinition(resolveRecordOutputDefinition, config);
  }

  if (spec.outputKind === "record") {
    return resolveRecordOutputDefinition();
  }

  return resolveExplicitCrudSchemaDefinition(config, ["deleteOutput"], {
    context: "defineCrudContract operations.delete.output",
    defaultMode: "replace"
  }) || buildCrudDeleteOutputDefinition();
}

function buildCrudOperations(source, namespace, operationNames) {
  const resolveRecordOutputDefinition = createCrudRecordOutputDefinitionResolver(source);
  const operations = {};

  for (const operationName of operationNames) {
    const spec = CRUD_OPERATION_SPECS[operationName];
    const operation = {
      method: spec.method
    };
    if (spec.includeRealtimeEvent) {
      operation.realtime = {
        events: [resolveCrudRecordChangedEvent(namespace)]
      };
    }
    if (spec.bodyOperation) {
      operation.body = resolveCrudBodyDefinition(spec, source);
    }
    operation.output = resolveCrudOutputDefinition(spec, resolveRecordOutputDefinition, source.config);
    operations[operationName] = operation;
  }

  return operations;
}

function normalizeContractFields(resource, fields) {
  if (fields === undefined) {
    return {};
  }
  if (!isRecord(fields)) {
    throw new TypeError("defineCrudContract fields must be an object keyed by field.");
  }
  return Object.fromEntries(Object.entries(fields).map(([fieldKey, entry]) => {
    if (!Object.hasOwn(resource.schema, fieldKey)) {
      throw new TypeError(`defineCrudContract fields.${fieldKey} is not a field of the ${resource.name} resource.`);
    }
    const operations = normalizeCrudFieldOperations(fieldKey, entry);
    if (storedTimestamps(resource.schema).includes(fieldKey) && Object.keys(operations).some((name) => name !== "output")) {
      refuseStampedField(resource.name, `fields.${fieldKey}`, fieldKey);
    }
    return [fieldKey, operations];
  }));
}

function requireContractConfig(config) {
  if (!isRecord(config)) {
    throw new TypeError("defineCrudContract requires a contract object.");
  }
  for (const key of Object.keys(config)) {
    if (!CONTRACT_KEYS.has(key)) {
      throw new TypeError(
        `defineCrudContract does not take ${key}. A CRUD contract takes ${[...CONTRACT_KEYS].join(", ")}; ` +
          "table facts belong to the table resource, and other operations to an API contract (defineApiContract)."
      );
    }
  }
  if (isRecord(config.contract) && Object.hasOwn(config.contract, "response")) {
    throw new TypeError("defineCrudContract contract.response belongs to the table resource: its defaultExclude.");
  }
}

/**
 * The CRUD surface of a table resource: the HTTP namespace, who may call it,
 * which of list, view, create, replace, patch and delete it offers, and the
 * fields each one takes and returns. defineCrudFeature serves it.
 * A field's entry in `fields` says, for each operation it takes part in,
 * "required", "optional", true or the keys merged over its definition; a field
 * without one takes the default (see buildCrudOperationSchemaFields).
 * Operations that are not CRUD belong to an API contract (defineApiContract).
 * @param {Record<string, any>} resource A table resource from defineTableResource.
 * @param {Record<string, any>} config
 * @param {string} config.namespace The HTTP, message and realtime namespace, named on purpose: it is the API's
 *   public name, and renaming the resource must not move it.
 * @param {string} [config.apiAccess] "authenticated" or "public".
 * @param {string[]} [config.operations] The CRUD operations offered; list, view, create, patch and delete when absent.
 * @param {Record<string, Record<string, unknown>>} [config.fields]
 */
function defineCrudContract(resource, config) {
  if (!isTableResource(resource)) {
    throw new TypeError("defineCrudContract requires a table resource from defineTableResource.");
  }
  requireContractConfig(config);
  const namespace = normalizeText(config.namespace);
  if (!namespace) {
    throw new TypeError(
      `defineCrudContract(${resource.name}) needs namespace: the HTTP, message and realtime namespace its routes, ` +
        "messages and events use, such as \"bookings\". It is the API's public name, so it is named, not taken from the resource."
    );
  }
  const source = Object.freeze({
    resource,
    config,
    fields: normalizeContractFields(resource, config.fields)
  });
  const contract = defineApiContract({
    namespace,
    ...(config.apiAccess === undefined ? {} : { apiAccess: config.apiAccess }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(config.contract === undefined ? {} : { contract: normalizeObject(config.contract) }),
    resource,
    operations: buildCrudOperations(source, namespace, resolveCrudOperationNames(config.operations))
  });
  crudContracts.add(contract);
  return contract;
}

/**
 * Whether a value is a CRUD contract defineCrudContract returned.
 * @param {unknown} value
 */
function isCrudContract(value) {
  return isRecord(value) && crudContracts.has(value);
}

export { defineCrudContract, isCrudContract };
