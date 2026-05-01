import {
  createSchema,
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { buildCrudOperationSchemaFields } from "@jskit-ai/kernel/shared/support/crudFieldContract";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { requireCrudNamespace, resolveCrudRecordChangedEvent } from "./crudNamespaceSupport.js";

const STANDARD_CRUD_OPERATION_NAMES = Object.freeze([
  "list",
  "view",
  "create",
  "patch",
  "delete"
]);

function createCrudRecordIdFieldDefinition() {
  return {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  };
}

function resolveCrudLookupContainerKey(resource = {}) {
  return normalizeText(resource?.contract?.lookup?.containerKey);
}

function createCrudRecordOutputValidator(resource = {}) {
  const fields = {
    id: createCrudRecordIdFieldDefinition(),
    ...buildCrudOperationSchemaFields(resource?.schema, "output")
  };
  const lookupContainerKey = resolveCrudLookupContainerKey(resource);

  if (lookupContainerKey) {
    fields[lookupContainerKey] = {
      type: "object",
      required: false
    };
  }

  return deepFreeze({
    schema: createSchema(fields),
    mode: "replace"
  });
}

function createCrudBodyValidator(resource = {}, mode = "patch") {
  return deepFreeze({
    schema: createSchema(buildCrudOperationSchemaFields(resource?.schema, mode)),
    mode
  });
}

function createCrudDeleteOutputValidator() {
  return deepFreeze({
    schema: createSchema({
      id: createCrudRecordIdFieldDefinition(),
      deleted: {
        type: "boolean",
        required: true
      }
    }),
    mode: "replace"
  });
}

function requireCrudOperationName(value = "", { context = "crud operation name" } = {}) {
  const normalizedName = normalizeText(value).toLowerCase();
  if (STANDARD_CRUD_OPERATION_NAMES.includes(normalizedName)) {
    return normalizedName;
  }
  throw new Error(
    `${context} must be one of: ${STANDARD_CRUD_OPERATION_NAMES.join(", ")}. ` +
      `Received: ${JSON.stringify(value)}.`
  );
}

function resolveCrudOperationNames(resource = {}) {
  const hasConfiguredOperations = Array.isArray(resource?.crudOperations);
  const configuredOperations = hasConfiguredOperations
    ? resource.crudOperations
    : STANDARD_CRUD_OPERATION_NAMES;
  const names = [];
  const seen = new Set();

  for (const rawName of configuredOperations) {
    const operationName = requireCrudOperationName(rawName, {
      context: "defineCrudResource crudOperations"
    });
    if (seen.has(operationName)) {
      continue;
    }
    seen.add(operationName);
    names.push(operationName);
  }

  if (hasConfiguredOperations) {
    return names;
  }

  return names.length > 0 ? names : [...STANDARD_CRUD_OPERATION_NAMES];
}

function createCrudOperationDefinition(operationName, { namespace = "", recordOutputValidator, resource = {} } = {}) {
  if (operationName === "list") {
    return {
      realtime: {
        events: [resolveCrudRecordChangedEvent(namespace)]
      },
      method: "GET",
      output: createCursorListValidator(recordOutputValidator)
    };
  }

  if (operationName === "view") {
    return {
      method: "GET",
      output: recordOutputValidator
    };
  }

  if (operationName === "create") {
    return {
      method: "POST",
      body: createCrudBodyValidator(resource, "create"),
      output: recordOutputValidator
    };
  }

  if (operationName === "patch") {
    return {
      method: "PATCH",
      body: createCrudBodyValidator(resource, "patch"),
      output: recordOutputValidator
    };
  }

  if (operationName === "delete") {
    return {
      method: "DELETE",
      output: createCrudDeleteOutputValidator()
    };
  }

  throw new Error(`createCrudOperationDefinition received unsupported operation "${operationName}".`);
}

function createDefaultCrudOperations(resource = {}) {
  const namespace = requireCrudNamespace(resource?.namespace, {
    context: "createDefaultCrudOperations resource.namespace"
  });
  const recordOutputValidator = createCrudRecordOutputValidator(resource);
  const operations = {};

  for (const operationName of resolveCrudOperationNames(resource)) {
    operations[operationName] = createCrudOperationDefinition(operationName, {
      namespace,
      recordOutputValidator,
      resource
    });
  }

  return operations;
}

function mergeCrudOperationDefinition(baseDefinition, overrideDefinition) {
  const normalizedBase = normalizeObject(baseDefinition);
  const normalizedOverride = normalizeObject(overrideDefinition);
  const mergedRealtime = {
    ...normalizeObject(normalizedBase.realtime),
    ...normalizeObject(normalizedOverride.realtime)
  };

  return {
    ...normalizedBase,
    ...normalizedOverride,
    ...(Object.keys(mergedRealtime).length > 0 ? { realtime: mergedRealtime } : {})
  };
}

function mergeCrudOperations(defaultOperations = {}, overrides = {}) {
  const baseEntries = normalizeObject(defaultOperations);
  const overrideEntries = normalizeObject(overrides);
  const merged = {};

  for (const [operationName, baseDefinition] of Object.entries(baseEntries)) {
    merged[operationName] = mergeCrudOperationDefinition(baseDefinition, overrideEntries[operationName]);
  }

  for (const [operationName, overrideDefinition] of Object.entries(overrideEntries)) {
    if (Object.hasOwn(merged, operationName)) {
      continue;
    }

    merged[operationName] = overrideDefinition;
  }

  return merged;
}

function defineCrudResource(resource = {}) {
  const source = normalizeObject(resource);
  const {
    crudOperations: _crudOperations,
    ...authoredResource
  } = source;

  return deepFreeze({
    ...authoredResource,
    namespace: requireCrudNamespace(authoredResource.namespace, {
      context: "defineCrudResource resource.namespace"
    }),
    idColumn: normalizeText(authoredResource.idColumn) || "id",
    operations: mergeCrudOperations(
      createDefaultCrudOperations(source),
      authoredResource.operations
    )
  });
}

export { defineCrudResource };
