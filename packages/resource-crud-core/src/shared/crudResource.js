import {
  createSchema,
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { buildCrudOperationSchemaFields } from "@jskit-ai/kernel/shared/support/crudFieldContract";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createSchemaDefinition,
  defineResource,
  normalizeSchemaDefinitionLike
} from "@jskit-ai/resource-core/shared/resource";
import { requireCrudNamespace, resolveCrudRecordChangedEvent } from "./crudNamespaceSupport.js";

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

const CRUD_OPERATION_SPECS = deepFreeze({
  list: {
    method: "GET",
    outputKind: "list",
    includeRealtimeEvent: true
  },
  view: {
    method: "GET",
    outputKind: "record"
  },
  create: {
    method: "POST",
    outputKind: "record",
    bodyOperation: "create",
    bodyMode: "create",
    explicitBodyKeys: ["createBody", "body"]
  },
  replace: {
    method: "PUT",
    outputKind: "record",
    bodyOperation: "replace",
    bodyMode: "replace",
    explicitBodyKeys: ["replaceBody", "body", "createBody"]
  },
  patch: {
    method: "PATCH",
    outputKind: "record",
    bodyOperation: "patch",
    bodyMode: "patch",
    explicitBodyKeys: ["patchBody", "body"]
  },
  delete: {
    method: "DELETE",
    outputKind: "delete"
  }
});

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

function resolveFieldEntries(resource = {}, operationName = "output") {
  return buildCrudOperationSchemaFields(resource?.schema, operationName);
}

function createDerivedCrudRecordOutputDefinition(resource = {}) {
  const outputFields = resolveFieldEntries(resource, "output");
  if (Object.keys(outputFields).length < 1) {
    throw new Error(
      "defineCrudResource derived output requires explicit crud.output or at least one schema field with operations.output."
    );
  }

  const fields = {
    id: createCrudRecordIdFieldDefinition(),
    ...outputFields
  };
  const lookupContainerKey = resolveCrudLookupContainerKey(resource);

  if (lookupContainerKey) {
    fields[lookupContainerKey] = {
      type: "object",
      required: false
    };
  }

  return createSchemaDefinition(createSchema(fields), "replace", {
    context: "defineCrudResource derived output"
  });
}

function createDerivedCrudBodyDefinition(resource = {}, operationName = "patch") {
  let fields = resolveFieldEntries(resource, operationName);

  if (operationName === "replace" && Object.keys(fields).length === 0) {
    fields = resolveFieldEntries(resource, "create");
  }

  if (Object.keys(fields).length < 1) {
    const fieldHint = operationName === "replace"
      ? "operations.replace or operations.create"
      : `operations.${operationName}`;
    throw new Error(
      `defineCrudResource derived ${operationName} body requires explicit crud.${operationName}Body or at least one schema field with ${fieldHint}.`
    );
  }

  const defaultMode = operationName === "create"
    ? "create"
    : operationName === "replace"
      ? "replace"
      : "patch";

  return createSchemaDefinition(createSchema(fields), defaultMode, {
    context: `defineCrudResource derived ${operationName} body`
  });
}

function createCrudDeleteOutputDefinition() {
  return createSchemaDefinition(createSchema({
    id: createCrudRecordIdFieldDefinition(),
    deleted: {
      type: "boolean",
      required: true
    }
  }), "replace", {
    context: "defineCrudResource delete output"
  });
}

function requireCrudOperationName(value = "", { context = "crud operation name" } = {}) {
  const normalizedName = normalizeText(value).toLowerCase();
  if (SUPPORTED_CRUD_OPERATION_NAMES.includes(normalizedName)) {
    return normalizedName;
  }
  throw new Error(
    `${context} must be one of: ${SUPPORTED_CRUD_OPERATION_NAMES.join(", ")}. ` +
      `Received: ${JSON.stringify(value)}.`
  );
}

function requireCrudOperationSpec(operationName = "") {
  const spec = CRUD_OPERATION_SPECS[operationName];
  if (spec) {
    return spec;
  }
  throw new Error(`createCrudOperationDefinition received unsupported operation "${operationName}".`);
}

function resolveCrudOperationNames(resource = {}) {
  const hasConfiguredOperations = Array.isArray(resource?.crudOperations);
  const configuredOperations = hasConfiguredOperations
    ? resource.crudOperations
    : DEFAULT_CRUD_OPERATION_NAMES;
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

  return names.length > 0 ? names : [...DEFAULT_CRUD_OPERATION_NAMES];
}

function resolveFirstPresentValue(source = {}, keys = []) {
  for (const key of Array.isArray(keys) ? keys : []) {
    if (Object.hasOwn(source, key) && source[key] != null) {
      return source[key];
    }
  }
  return null;
}

function resolveExplicitCrudSchemaDefinition(crudConfig = {}, keys = [], {
  context = "defineCrudResource schema definition",
  defaultMode = "patch"
} = {}) {
  const explicitValue = resolveFirstPresentValue(crudConfig, keys);
  if (explicitValue == null) {
    return null;
  }

  return normalizeSchemaDefinitionLike(explicitValue, {
    context,
    defaultMode
  });
}

function createCrudListOutputDefinition(resolveRecordOutputDefinition, crudConfig = {}) {
  const explicitListOutput = resolveExplicitCrudSchemaDefinition(crudConfig, ["listOutput"], {
    context: "defineCrudResource crud.listOutput",
    defaultMode: "replace"
  });
  if (explicitListOutput) {
    return explicitListOutput;
  }

  const explicitListItemOutput = resolveExplicitCrudSchemaDefinition(crudConfig, ["listItemOutput"], {
    context: "defineCrudResource crud.listItemOutput",
    defaultMode: "replace"
  });
  if (explicitListItemOutput) {
    return createCursorListValidator(
      explicitListItemOutput
    );
  }

  return createCursorListValidator(resolveRecordOutputDefinition());
}

function createCrudRecordOutputDefinitionResolver(resource = {}, crudConfig = {}) {
  let cachedDefinition = null;
  let hasResolved = false;

  return function resolveRecordOutputDefinition() {
    if (hasResolved) {
      return cachedDefinition;
    }

    cachedDefinition = resolveExplicitCrudSchemaDefinition(crudConfig, ["output"], {
      context: "defineCrudResource crud.output",
      defaultMode: "replace"
    }) || createDerivedCrudRecordOutputDefinition(resource);
    hasResolved = true;
    return cachedDefinition;
  };
}

function resolveCrudBodyDefinition(spec, resource = {}, crudConfig = {}) {
  const explicitBody = resolveExplicitCrudSchemaDefinition(
    crudConfig,
    spec.explicitBodyKeys,
    {
      context: `defineCrudResource operations.${spec.bodyOperation}.body`,
      defaultMode: spec.bodyMode
    }
  );
  if (explicitBody) {
    return explicitBody;
  }

  return createDerivedCrudBodyDefinition(resource, spec.bodyOperation);
}

function resolveCrudOutputDefinition(spec, resolveRecordOutputDefinition, crudConfig = {}) {
  if (spec.outputKind === "list") {
    return createCrudListOutputDefinition(resolveRecordOutputDefinition, crudConfig);
  }

  if (spec.outputKind === "record") {
    return resolveRecordOutputDefinition();
  }

  if (spec.outputKind === "delete") {
    return resolveExplicitCrudSchemaDefinition(crudConfig, ["deleteOutput"], {
      context: "defineCrudResource operations.delete.output",
      defaultMode: "replace"
    }) || createCrudDeleteOutputDefinition();
  }

  throw new Error(`resolveCrudOutputDefinition received unsupported output kind "${spec.outputKind}".`);
}

function createCrudOperationDefinition(operationName, {
  namespace = "",
  resource = {},
  crudConfig = {},
  resolveRecordOutputDefinition
} = {}) {
  const spec = requireCrudOperationSpec(operationName);
  const nextOperation = {
    method: spec.method
  };

  if (spec.includeRealtimeEvent) {
    nextOperation.realtime = {
      events: [resolveCrudRecordChangedEvent(namespace)]
    };
  }

  if (spec.bodyOperation) {
    nextOperation.body = resolveCrudBodyDefinition(spec, resource, crudConfig);
  }

  nextOperation.output = resolveCrudOutputDefinition(spec, resolveRecordOutputDefinition, crudConfig);
  return nextOperation;
}

function createDefaultCrudOperations(resource = {}) {
  const namespace = requireCrudNamespace(resource?.namespace, {
    context: "createDefaultCrudOperations resource.namespace"
  });
  const crudConfig = normalizeObject(resource?.crud);
  const resolveRecordOutputDefinition = createCrudRecordOutputDefinitionResolver(resource, crudConfig);
  const operations = {};

  for (const operationName of resolveCrudOperationNames(resource)) {
    operations[operationName] = createCrudOperationDefinition(operationName, {
      namespace,
      resource,
      crudConfig,
      resolveRecordOutputDefinition
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
    crud: _crudConfig,
    crudOperations: _crudOperations,
    ...authoredResource
  } = source;

  return defineResource({
    ...authoredResource,
    operations: mergeCrudOperations(
      createDefaultCrudOperations(source),
      authoredResource.operations
    )
  });
}

export { defineCrudResource };
