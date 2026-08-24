import {
  composeSchemaDefinitions,
  createSchema,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeJsonApiFieldsets } from "@jskit-ai/kernel/shared/support/jsonApiFieldsets";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import {
  decodeJsonApiResourceResponse,
  normalizeJsonApiDocument,
  unwrapJsonApiResult
} from "@jskit-ai/http-runtime/shared";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  resolveJsonApiFieldsetContract,
  resolveJsonApiRelationshipEntries,
  resolveSchemaFieldDefinitions
} from "../jsonApiResourceContract.js";
import {
  createJsonApiFieldsetsQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../listQueryValidators.js";

const CRUD_OPERATION_NAMES = Object.freeze(["list", "view", "create", "update", "delete"]);
const CRUD_MUTATION_NAMES = new Set(["create", "update", "delete"]);
const CRUD_LIFECYCLE_PHASES = Object.freeze(["before", "execute", "after", "afterCommit"]);
const CRUD_ASSISTANT_RESOURCE_OPERATION = Object.freeze({
  list: "list",
  view: "view",
  create: "create",
  update: "patch",
  delete: "delete"
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalCursor(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveAssistantResultValue(result) {
  const taggedResult = unwrapJsonApiResult(result);
  const value = taggedResult ? taggedResult.value : result;
  const document = normalizeJsonApiDocument(value);
  return {
    value,
    document
  };
}

function createProjectionRecordSchema(recordSchema, {
  lookupContainerKey = "",
  relationshipEntries = []
} = {}) {
  const definitions = recordSchema?.getFieldDefinitions?.();
  if (!isRecord(definitions)) {
    return recordSchema;
  }

  const fields = Object.fromEntries(
    Object.entries(definitions).map(([fieldKey, fieldDefinition]) => [
      fieldKey,
      {
        ...fieldDefinition,
        required: fieldKey === "id" && fieldDefinition?.required === true
      }
    ])
  );
  if (lookupContainerKey && isRecord(fields[lookupContainerKey])) {
    const createRelatedRecordSchema = (entry) => createSchema({
      id: {
        type: "string",
        required: true
      },
      ...(entry.labelKey && entry.labelKey !== "id"
        ? {
            [entry.labelKey]: {
              type: "string",
              required: false,
              nullable: true
            }
          }
        : {})
    });
    const lookupFields = Object.fromEntries(
      relationshipEntries.map((entry) => [
        entry.relationshipName,
        entry.many === true
          ? {
              type: "array",
              required: false,
              items: {
                type: "object",
                schema: createRelatedRecordSchema(entry),
                additionalProperties: true
              }
            }
          : {
              type: "object",
              required: false,
              schema: createRelatedRecordSchema(entry),
              additionalProperties: true
            }
      ])
    );
    fields[lookupContainerKey] = {
      ...fields[lookupContainerKey],
      type: "object",
      required: false,
      ...(Object.keys(lookupFields).length > 0 ? { schema: createSchema(lookupFields) } : {}),
      additionalProperties: true
    };
  }

  return createSchema(fields);
}

function createProjectionOutputDefinition(output, operation, relationshipEntries, lookupContainerKey) {
  if (!output || (operation !== "list" && operation !== "view")) {
    return output;
  }

  if (operation === "view") {
    return Object.freeze({
      schema: createProjectionRecordSchema(output.schema, { lookupContainerKey, relationshipEntries }),
      mode: "replace"
    });
  }

  const listFields = resolveSchemaFieldDefinitions(output);
  const items = listFields.items;
  if (!isRecord(items) || items.type !== "array" || typeof items.items?.getFieldDefinitions !== "function") {
    return output;
  }

  return Object.freeze({
    schema: createSchema({
      ...listFields,
      items: {
        ...items,
        items: createProjectionRecordSchema(items.items, { lookupContainerKey, relationshipEntries })
      }
    }),
    mode: "replace"
  });
}

function createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey) {
  const lookupFieldMap = Object.fromEntries(
    relationshipEntries
      .filter((entry) => entry.many !== true)
      .map((entry) => [entry.relationshipName, entry.attributeKey])
  );
  return Object.freeze({
    kind: "jsonapi-resource",
    responseType: resource.namespace,
    responseKind: operation === "list" ? "collection" : "record",
    ...(lookupContainerKey ? { lookupContainerKey } : {}),
    ...(Object.keys(lookupFieldMap).length > 0 ? { lookupFieldMap } : {})
  });
}

function projectCrudAssistantRecordFields(record, selectedFields = null, {
  preserveKeys = []
} = {}) {
  if (!isRecord(record) || !Array.isArray(selectedFields)) {
    return record;
  }

  const allowedKeys = new Set(["id", ...preserveKeys, ...selectedFields]);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => allowedKeys.has(key))
  );
}

function projectCrudAssistantLookupValue(value, selectedFields = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => projectCrudAssistantRecordFields(entry, selectedFields));
  }
  return projectCrudAssistantRecordFields(value, selectedFields);
}

function projectCrudAssistantReadRecord(record, {
  lookupContainerKey = "",
  primaryFields = null,
  relatedFieldsByLookupKey = new Map()
} = {}) {
  if (!isRecord(record)) {
    return record;
  }

  const primaryProjection = projectCrudAssistantRecordFields(record, primaryFields, {
    preserveKeys: lookupContainerKey && isRecord(record[lookupContainerKey])
      ? [lookupContainerKey]
      : []
  });
  const projectedRecord = primaryProjection === record ? { ...record } : primaryProjection;
  if (!lookupContainerKey || !isRecord(projectedRecord[lookupContainerKey])) {
    return projectedRecord;
  }

  projectedRecord[lookupContainerKey] = Object.fromEntries(
    Object.entries(projectedRecord[lookupContainerKey]).map(([lookupKey, value]) => {
      return [
        lookupKey,
        projectCrudAssistantLookupValue(value, relatedFieldsByLookupKey.get(lookupKey))
      ];
    })
  );
  return projectedRecord;
}

function createCrudAssistantResultProjection(input = {}, resource = {}, relationshipEntries = []) {
  const primaryType = String(resource?.namespace || "").trim();
  const fieldsets = normalizeJsonApiFieldsets(input?.fields, {
    primaryType
  });
  if (Object.keys(fieldsets).length < 1) {
    return null;
  }

  const relatedFieldsByLookupKey = new Map();
  for (const entry of relationshipEntries) {
    const selectedFields = fieldsets[entry.relationshipType];
    if (!Array.isArray(selectedFields)) {
      continue;
    }
    relatedFieldsByLookupKey.set(entry.relationshipName, selectedFields);
    relatedFieldsByLookupKey.set(entry.attributeKey, selectedFields);
  }

  return {
    primaryFields: fieldsets[primaryType],
    relatedFieldsByLookupKey
  };
}

function projectCrudAssistantReadResult(result, projection = null, {
  lookupContainerKey = ""
} = {}) {
  if (!projection) {
    return result;
  }

  const projectionOptions = {
    ...projection,
    lookupContainerKey
  };
  if (isRecord(result) && Array.isArray(result.items)) {
    return {
      ...result,
      items: result.items.map((entry) => projectCrudAssistantReadRecord(entry, projectionOptions))
    };
  }

  return projectCrudAssistantReadRecord(result, projectionOptions);
}

function transformCrudAssistantResult(operation, result, {
  input = {},
  resource,
  relationshipEntries = [],
  lookupContainerKey = ""
} = {}) {
  if (operation === "delete") {
    const resolved = resolveAssistantResultValue(result);
    if (isRecord(resolved.value) && resolved.value.deleted === true && resolved.value.id != null) {
      return resolved.value;
    }
    return {
      id: String(input.recordId || ""),
      deleted: true
    };
  }

  const resolved = resolveAssistantResultValue(result);
  const projection = operation === "list" || operation === "view"
    ? createCrudAssistantResultProjection(input, resource, relationshipEntries)
    : null;
  const projectReadResult = (value) => projectCrudAssistantReadResult(value, projection, {
    lookupContainerKey
  });
  if (operation === "list") {
    if (resolved.document.kind === "collection") {
      const decoded = decodeJsonApiResourceResponse(
        resolved.value,
        createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey)
      );
      return projectReadResult({
        items: decoded.items,
        nextCursor: normalizeOptionalCursor(decoded.nextCursor)
      });
    }
    if (Array.isArray(resolved.value)) {
      return projectReadResult({
        items: resolved.value,
        nextCursor: null
      });
    }
    if (isRecord(resolved.value) && Array.isArray(resolved.value.items)) {
      return projectReadResult({
        items: resolved.value.items,
        nextCursor: normalizeOptionalCursor(resolved.value.nextCursor)
      });
    }
    return resolved.value;
  }

  if (resolved.document.kind === "resource") {
    return projectReadResult(decodeJsonApiResourceResponse(
      resolved.value,
      createCrudAssistantTransport(resource, operation, relationshipEntries, lookupContainerKey)
    ));
  }
  return projectReadResult(resolved.value);
}

function createCrudAssistantReadDescription({
  fieldsetContract,
  lookupContainerKey = "",
  namespace = "",
  operation = "list"
} = {}) {
  const relationshipEntries = fieldsetContract.relationshipEntries;
  const firstRelationship = relationshipEntries[0] || null;
  const includeExample = relationshipEntries.length > 0
    ? relationshipEntries.slice(0, 2).map((entry) => entry.relationshipName).join(",")
    : "pet,service";
  const fieldsExample = firstRelationship
    ? ` fields can be {\"${namespace}\":[\"${firstRelationship.attributeKey}\"],` +
      `\"${firstRelationship.relationshipType}\":[\"${firstRelationship.labelKey || "id"}\"]}.`
    : ` fields can be {\"${namespace}\":[\"id\"]}.`;
  const aliasGuidance = fieldsetContract.aliasMappings
    .map((entry) => `use \"${entry.resourceType}\" instead of \"${entry.alias}\"`)
    .join("; ");
  const fieldsetKeyGuidance = fieldsetContract.resourceTypes.length > 0
    ? ` fields keys must be JSON:API resource types: ${fieldsetContract.resourceTypes.map((entry) => `\"${entry}\"`).join(", ")}.` +
      (aliasGuidance ? ` Relationship aliases are invalid fieldset keys; ${aliasGuidance}.` : "")
    : "";
  const primaryFieldGuidance = fieldsetContract.primaryFields.length > 0
    ? ` Valid \"${namespace}\" fields: ${fieldsetContract.primaryFields.map((entry) => `\"${entry}\"`).join(", ")}.`
    : "";
  const relationshipGuidance = relationshipEntries.length > 0
    ? ` Include relationships: ${relationshipEntries.map((entry) => {
        const lookupPath = lookupContainerKey
          ? ` -> ${operation === "list" ? "items[]." : ""}${lookupContainerKey}.${entry.relationshipName}`
          : "";
        return `\"${entry.relationshipName}\" -> resource type \"${entry.relationshipType}\"${lookupPath}`;
      }).join("; ")}.`
    : "";

  const subject = operation === "list" ? `List ${namespace} records.` : `View a ${namespace} record.`;
  return `${subject} include must be a comma-separated string such as \"${includeExample}\";` +
    `${fieldsExample}${fieldsetKeyGuidance}${primaryFieldGuidance}${relationshipGuidance}`;
}

function createCrudAssistantExtension(resource, namespace, operation) {
  const resourceOperation = CRUD_ASSISTANT_RESOURCE_OPERATION[operation];
  const nativeOutput = resource?.operations?.[resourceOperation]?.output || null;
  const recordOutput = operation === "list"
    ? Object.freeze({
        schema: resolveSchemaFieldDefinitions(nativeOutput).items?.items,
        mode: "replace"
      })
    : nativeOutput;
  const relationshipEntries = resolveJsonApiRelationshipEntries(recordOutput);
  const lookupContainerKey = String(resource?.contract?.lookup?.containerKey || "").trim();
  const output = createProjectionOutputDefinition(
    nativeOutput,
    operation,
    relationshipEntries,
    lookupContainerKey
  );
  const actionLabel = operation === "list" || operation === "view"
    ? createCrudAssistantReadDescription({
        fieldsetContract: resolveJsonApiFieldsetContract(resource),
        lookupContainerKey,
        namespace,
        operation
      })
    : operation === "create"
      ? `Create a ${namespace} record.`
      : operation === "update"
        ? `Update a ${namespace} record.`
        : `Delete a ${namespace} record.`;

  return Object.freeze({
    description: actionLabel,
    output,
    transformResult(result, context) {
      return transformCrudAssistantResult(operation, result, {
        ...context,
        resource,
        relationshipEntries,
        lookupContainerKey
      });
    }
  });
}

function createActionInput(
  resource,
  operation,
  scopeInputValidator = null,
  listFilterQueryValidator = null,
  operationInputs = {}
) {
  const definitions = scopeInputValidator ? [scopeInputValidator] : [];
  if (operation === "list") {
    definitions.push(...createStandardCrudListQueryValidators({
      resource,
      listFilterQueryValidator,
      fieldsetsQueryValidator: createJsonApiFieldsetsQueryValidator({ resource })
    }));
  } else if (operation === "view") {
    definitions.push(recordIdParamsValidator, ...createStandardCrudViewQueryValidators({
      fieldsetsQueryValidator: createJsonApiFieldsetsQueryValidator({ resource })
    }));
  } else if (operation === "create") {
    definitions.push(operationInputs.create || resource.operations.create.body);
  } else if (operation === "update") {
    definitions.push(recordIdParamsValidator, operationInputs.update || resource.operations.patch.body);
  } else {
    definitions.push(recordIdParamsValidator);
  }

  return composeSchemaDefinitions(definitions, operation === "create" ? { mode: "create" } : {});
}

function omitInputKeys(input = {}, keys = []) {
  const result = { ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}) };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

function normalizeCrudOperationLifecycle(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("CRUD operationLifecycle must be an object.");
  }

  const lifecycle = {};
  for (const [operation, hooks] of Object.entries(value)) {
    assertCrudOperationName(operation);
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
      throw new TypeError(`CRUD operationLifecycle.${operation} must be an object.`);
    }
    for (const name of Object.keys(hooks)) {
      if (!CRUD_LIFECYCLE_PHASES.includes(name)) {
        throw new TypeError(`CRUD operationLifecycle.${operation} has unknown phase "${name}".`);
      }
      if (typeof hooks[name] !== "function") {
        throw new TypeError(`CRUD operationLifecycle.${operation}.${name} must be a function.`);
      }
    }
    if (!CRUD_MUTATION_NAMES.has(operation) && Object.hasOwn(hooks, "afterCommit")) {
      throw new TypeError(`CRUD operationLifecycle.${operation}.afterCommit is only valid for mutations.`);
    }
    lifecycle[operation] = Object.freeze({ ...hooks });
  }
  return Object.freeze(lifecycle);
}

function createLifecycleContext(value = {}) {
  const {
    operation,
    input,
    context,
    resource,
    repository,
    service,
    trx = null,
    result,
    standard
  } = value;
  return Object.freeze({
    operation,
    input,
    context,
    resource,
    repository,
    service,
    trx,
    ...(Object.hasOwn(value, "result") ? { result } : {}),
    ...(typeof standard === "function" ? { standard } : {})
  });
}

function normalizeAdditionalActions(value = {}, {
  namespace,
  surface,
  permissionForAction,
  scopeInputValidator = null
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("CRUD actions must be an object.");
  }

  return Object.freeze(Object.entries(value).map(([name, definition]) => {
    const actionName = String(name || "").trim();
    if (!/^[a-z][a-z0-9_.-]*$/u.test(actionName)) {
      throw new TypeError(`CRUD custom action name "${actionName}" is invalid.`);
    }
    if (CRUD_OPERATION_NAMES.includes(actionName)) {
      throw new TypeError(`CRUD custom action name "${actionName}" is reserved.`);
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new TypeError(`CRUD custom action "${actionName}" must be an object.`);
    }
    if (typeof definition.execute !== "function") {
      throw new TypeError(`CRUD custom action "${actionName}" requires execute().`);
    }
    if (!definition.input || typeof definition.input !== "object" || Array.isArray(definition.input)) {
      throw new TypeError(`CRUD custom action "${actionName}" requires an input schema.`);
    }

    const kind = definition.kind || "command";
    return Object.freeze({
      ...definition,
      name: actionName,
      id: String(definition.id || `${namespace}.${actionName}`).trim(),
      version: definition.version || 1,
      kind,
      channels: definition.channels || ["api", "automation", "internal"],
      surfaces: definition.surfaces || [surface],
      permission: definition.permission || permissionForAction(actionName),
      input: scopeInputValidator
        ? composeSchemaDefinitions([scopeInputValidator, definition.input])
        : definition.input,
      idempotency: definition.idempotency || (kind === "query" ? "none" : "optional"),
      audit: definition.audit || { actionName: String(definition.id || `${namespace}.${actionName}`).trim() },
      observability: definition.observability || {},
      events: definition.events || []
    });
  }));
}

function createCrudJsonApiActions({
  namespace,
  resource,
  repository = null,
  service,
  surface,
  permissionForOperation,
  permissionForAction = permissionForOperation,
  operations = CRUD_OPERATION_NAMES,
  scopeInputValidator = null,
  scopeInputKeys = [],
  listFilterQueryValidator = null,
  operationLifecycle = {},
  operationInputs = {},
  actions: additionalActionDefinitions = {},
  dependencies = {}
} = {}) {
  const actionId = (operation) => `crud.${namespace}.${operation}`;
  if (!service || typeof service !== "object") {
    throw new TypeError("createCrudJsonApiActions requires service.");
  }
  const permission = (operation) => permissionForOperation(operation);
  const input = (operation) => createActionInput(
    resource,
    operation,
    scopeInputValidator,
    listFilterQueryValidator,
    operationInputs
  );
  const recordChangedEvent = resolveCrudRecordChangedEvent(namespace);
  const mutationEvent = (operation, entityId) => createEntityChangedActionEvent({
    source: "crud",
    entity: "record",
    operation,
    entityId,
    realtime: {
      event: recordChangedEvent,
      audience: "event_scope"
    }
  });
  const lifecycle = normalizeCrudOperationLifecycle(operationLifecycle);
  const additionalActions = normalizeAdditionalActions(additionalActionDefinitions, {
    namespace,
    surface,
    permissionForAction,
    scopeInputValidator
  });

  async function executeOperation(operation, value, context, defaultExecute) {
    const hooks = lifecycle[operation];
    if (!hooks) {
      return defaultExecute(value, null);
    }

    async function run(trx = null) {
      const base = { operation, input: value, context, resource, repository, service, trx };
      if (hooks.before) {
        await hooks.before(createLifecycleContext(base));
      }
      const standard = (nextInput = value) => defaultExecute(nextInput, trx);
      const result = hooks.execute
        ? await hooks.execute(createLifecycleContext({ ...base, standard }))
        : await standard();
      if (hooks.after) {
        await hooks.after(createLifecycleContext({ ...base, result }));
      }
      return result;
    }

    const mutation = CRUD_MUTATION_NAMES.has(operation);
    if (mutation && (!repository || typeof repository.withTransaction !== "function")) {
      throw new TypeError(`CRUD operationLifecycle.${operation} requires repository.withTransaction().`);
    }
    const result = mutation ? await repository.withTransaction(run) : await run();
    if (hooks.afterCommit) {
      await hooks.afterCommit(createLifecycleContext({
        operation,
        input: value,
        context,
        resource,
        repository,
        service,
        result
      }));
    }
    return result;
  }

  const standardDefinitions = [
    {
      operation: "list",
      kind: "query",
      idempotency: "none",
      async execute(value, context) {
        return executeOperation("list", value, context, (nextInput) =>
          service.queryDocuments(omitInputKeys(nextInput, scopeInputKeys), { context })
        );
      }
    },
    {
      operation: "view",
      kind: "query",
      idempotency: "none",
      async execute(value, context) {
        return executeOperation("view", value, context, (nextInput) => {
          const query = omitInputKeys(nextInput, [...scopeInputKeys, "recordId"]);
          return service.getDocumentById(nextInput.recordId, query, { context });
        });
      }
    },
    {
      operation: "create",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("created", ({ result }) => result?.data?.id ?? result?.value?.data?.id)],
      async execute(value, context) {
        return executeOperation("create", value, context, (nextInput, trx) =>
          service.createDocument(omitInputKeys(nextInput, scopeInputKeys), { context, trx })
        );
      }
    },
    {
      operation: "update",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("updated", ({ input: value }) => value?.recordId)],
      async execute(value, context) {
        return executeOperation("update", value, context, (nextInput, trx) => {
          const patch = omitInputKeys(nextInput, [...scopeInputKeys, "recordId"]);
          return service.patchDocumentById(nextInput.recordId, patch, { context, trx });
        });
      }
    },
    {
      operation: "delete",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("deleted", ({ input: value }) => value?.recordId)],
      async execute(value, context) {
        return executeOperation("delete", value, context, (nextInput, trx) =>
          service.deleteDocumentById(nextInput.recordId, { context, trx })
        );
      }
    }
  ];

  const enabledOperations = new Set(operations);
  const standardActions = standardDefinitions.filter((definition) => enabledOperations.has(definition.operation)).map((definition) => {
    const id = actionId(definition.operation);
    return Object.freeze({
      id,
      version: 1,
      kind: definition.kind,
      channels: ["api", "automation", "internal"],
      surfaces: [surface],
      permission: permission(definition.operation),
      input: input(definition.operation),
      output: null,
      extensions: Object.freeze({
        assistant: createCrudAssistantExtension(resource, namespace, definition.operation)
      }),
      idempotency: definition.idempotency,
      audit: { actionName: id },
      observability: {},
      events: definition.events || [],
      execute: definition.execute
    });
  });
  const productActions = additionalActions.map((definition) => Object.freeze({
    id: definition.id,
    version: definition.version,
    kind: definition.kind,
    channels: definition.channels,
    surfaces: definition.surfaces,
    input: definition.input,
    output: definition.output || null,
    idempotency: definition.idempotency,
    permission: definition.permission,
    audit: definition.audit,
    observability: definition.observability,
    extensions: definition.extensions || {},
    events: definition.events,
    async execute(value, context) {
      return definition.execute(Object.freeze({
        ...dependencies,
        input: value,
        context,
        resource,
        repository,
        service
      }));
    }
  }));
  return Object.freeze([...standardActions, ...productActions]);
}

function assertCrudOperationName(operation = "") {
  if (!CRUD_OPERATION_NAMES.includes(operation)) {
    throw new TypeError(`Unknown CRUD operation "${operation}".`);
  }
  return operation;
}

export {
  assertCrudOperationName,
  createCrudJsonApiActions,
  normalizeCrudOperationLifecycle
};
