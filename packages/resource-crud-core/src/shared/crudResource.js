import {
  createSchema,
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { buildCrudOperationSchemaFields } from "@jskit-ai/kernel/shared/support/crudFieldContract";
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

function createDerivedCrudRecordOutputDefinition(resource = {}) {
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

  return createSchemaDefinition(createSchema(fields), "replace", {
    context: "defineCrudResource derived output"
  });
}

function createDerivedCrudBodyDefinition(resource = {}, operationName = "patch") {
  let fields = buildCrudOperationSchemaFields(resource?.schema, operationName);

  if (operationName === "replace" && Object.keys(fields).length === 0) {
    fields = buildCrudOperationSchemaFields(resource?.schema, "create");
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

function resolveCrudConfigValue(crudConfig = {}, operationName = "", key = "") {
  if (operationName === "create" && key === "body") {
    return crudConfig.createBody ?? crudConfig.body ?? null;
  }
  if (operationName === "replace" && key === "body") {
    return crudConfig.replaceBody ?? crudConfig.body ?? crudConfig.createBody ?? null;
  }
  if (operationName === "patch" && key === "body") {
    return crudConfig.patchBody ?? crudConfig.body ?? null;
  }
  if (operationName === "view" && key === "output") {
    return crudConfig.output ?? null;
  }
  if (operationName === "create" && key === "output") {
    return crudConfig.output ?? null;
  }
  if (operationName === "replace" && key === "output") {
    return crudConfig.output ?? null;
  }
  if (operationName === "patch" && key === "output") {
    return crudConfig.output ?? null;
  }
  if (operationName === "list" && key === "listOutput") {
    return crudConfig.listOutput ?? null;
  }
  if (operationName === "list" && key === "listItemOutput") {
    return crudConfig.listItemOutput ?? null;
  }
  if (operationName === "delete" && key === "output") {
    return crudConfig.deleteOutput ?? null;
  }

  return null;
}

function createCrudListOutputDefinition(recordOutputDefinition, crudConfig = {}) {
  const explicitListOutput = resolveCrudConfigValue(crudConfig, "list", "listOutput");
  if (explicitListOutput) {
    return normalizeSchemaDefinitionLike(explicitListOutput, {
      context: "defineCrudResource crud.listOutput",
      defaultMode: "replace"
    });
  }

  const explicitListItemOutput = resolveCrudConfigValue(crudConfig, "list", "listItemOutput");
  if (explicitListItemOutput) {
    return createCursorListValidator(
      normalizeSchemaDefinitionLike(explicitListItemOutput, {
        context: "defineCrudResource crud.listItemOutput",
        defaultMode: "replace"
      })
    );
  }

  return createCursorListValidator(recordOutputDefinition);
}

function createCrudOperationDefinition(operationName, {
  namespace = "",
  recordOutputDefinition,
  resource = {},
  crudConfig = {}
} = {}) {
  if (operationName === "list") {
    return {
      realtime: {
        events: [resolveCrudRecordChangedEvent(namespace)]
      },
      method: "GET",
      output: createCrudListOutputDefinition(recordOutputDefinition, crudConfig)
    };
  }

  if (operationName === "view") {
    return {
      method: "GET",
      output: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "view", "output") || recordOutputDefinition,
        {
          context: "defineCrudResource operations.view.output",
          defaultMode: "replace"
        }
      )
    };
  }

  if (operationName === "create") {
    return {
      method: "POST",
      body: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "create", "body") ||
          createDerivedCrudBodyDefinition(resource, "create"),
        {
          context: "defineCrudResource operations.create.body",
          defaultMode: "create"
        }
      ),
      output: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "create", "output") || recordOutputDefinition,
        {
          context: "defineCrudResource operations.create.output",
          defaultMode: "replace"
        }
      )
    };
  }

  if (operationName === "replace") {
    return {
      method: "PUT",
      body: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "replace", "body") ||
          createDerivedCrudBodyDefinition(resource, "replace"),
        {
          context: "defineCrudResource operations.replace.body",
          defaultMode: "replace"
        }
      ),
      output: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "replace", "output") || recordOutputDefinition,
        {
          context: "defineCrudResource operations.replace.output",
          defaultMode: "replace"
        }
      )
    };
  }

  if (operationName === "patch") {
    return {
      method: "PATCH",
      body: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "patch", "body") ||
          createDerivedCrudBodyDefinition(resource, "patch"),
        {
          context: "defineCrudResource operations.patch.body",
          defaultMode: "patch"
        }
      ),
      output: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "patch", "output") || recordOutputDefinition,
        {
          context: "defineCrudResource operations.patch.output",
          defaultMode: "replace"
        }
      )
    };
  }

  if (operationName === "delete") {
    return {
      method: "DELETE",
      output: normalizeSchemaDefinitionLike(
        resolveCrudConfigValue(crudConfig, "delete", "output") || createCrudDeleteOutputDefinition(),
        {
          context: "defineCrudResource operations.delete.output",
          defaultMode: "replace"
        }
      )
    };
  }

  throw new Error(`createCrudOperationDefinition received unsupported operation "${operationName}".`);
}

function createDefaultCrudOperations(resource = {}) {
  const namespace = requireCrudNamespace(resource?.namespace, {
    context: "createDefaultCrudOperations resource.namespace"
  });
  const crudConfig = normalizeObject(resource?.crud);
  const recordOutputDefinition = normalizeSchemaDefinitionLike(
    crudConfig.output || createDerivedCrudRecordOutputDefinition(resource),
    {
      context: "defineCrudResource crud.output",
      defaultMode: "replace"
    }
  );
  const operations = {};

  for (const operationName of resolveCrudOperationNames(resource)) {
    operations[operationName] = createCrudOperationDefinition(operationName, {
      namespace,
      recordOutputDefinition,
      resource,
      crudConfig
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
