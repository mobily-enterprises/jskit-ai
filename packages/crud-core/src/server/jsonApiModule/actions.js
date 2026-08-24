import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import {
  normalizeJsonApiDocument,
  simplifyJsonApiDocument,
  unwrapJsonApiResult
} from "@jskit-ai/http-runtime/shared";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
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

function resolveDocumentNextCursor(document = {}) {
  return normalizeOptionalCursor(
    document?.meta?.page?.nextCursor ?? document?.meta?.pagination?.cursor?.next
  );
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

function transformCrudAssistantResult(operation, result, { input = {} } = {}) {
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
  if (operation === "list") {
    if (resolved.document.kind === "collection") {
      return {
        items: simplifyJsonApiDocument(resolved.value),
        nextCursor: resolveDocumentNextCursor(resolved.document)
      };
    }
    if (Array.isArray(resolved.value)) {
      return {
        items: resolved.value,
        nextCursor: null
      };
    }
    if (isRecord(resolved.value) && Array.isArray(resolved.value.items)) {
      return {
        items: resolved.value.items,
        nextCursor: normalizeOptionalCursor(resolved.value.nextCursor)
      };
    }
    return resolved.value;
  }

  if (resolved.document.kind === "resource") {
    return simplifyJsonApiDocument(resolved.value);
  }
  return resolved.value;
}

function createCrudAssistantExtension(resource, namespace, operation) {
  const resourceOperation = CRUD_ASSISTANT_RESOURCE_OPERATION[operation];
  const output = resource?.operations?.[resourceOperation]?.output || null;
  const actionLabel = operation === "list"
    ? `List ${namespace} records.`
    : operation === "view"
      ? `View a ${namespace} record.`
      : operation === "create"
        ? `Create a ${namespace} record.`
        : operation === "update"
          ? `Update a ${namespace} record.`
          : `Delete a ${namespace} record.`;

  return Object.freeze({
    description: actionLabel,
    output,
    transformResult(result, context) {
      return transformCrudAssistantResult(operation, result, context);
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
    definitions.push(...createStandardCrudListQueryValidators({ resource, listFilterQueryValidator }));
  } else if (operation === "view") {
    definitions.push(recordIdParamsValidator, ...createStandardCrudViewQueryValidators());
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
