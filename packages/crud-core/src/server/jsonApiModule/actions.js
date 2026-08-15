import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../listQueryValidators.js";

const CRUD_OPERATION_NAMES = Object.freeze(["list", "view", "create", "update", "delete"]);

function createActionInput(resource, operation, scopeInputValidator = null) {
  const definitions = scopeInputValidator ? [scopeInputValidator] : [];
  if (operation === "list") {
    definitions.push(...createStandardCrudListQueryValidators({ resource }));
  } else if (operation === "view") {
    definitions.push(recordIdParamsValidator, ...createStandardCrudViewQueryValidators());
  } else if (operation === "create") {
    definitions.push(resource.operations.create.body);
  } else if (operation === "update") {
    definitions.push(recordIdParamsValidator, resource.operations.patch.body);
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

function createCrudJsonApiActions({
  namespace,
  resource,
  service,
  surface,
  permissionForOperation,
  scopeInputValidator = null,
  scopeInputKeys = []
} = {}) {
  const actionId = (operation) => `crud.${namespace}.${operation}`;
  if (!service || typeof service !== "object") {
    throw new TypeError("createCrudJsonApiActions requires service.");
  }
  const permission = (operation) => permissionForOperation(operation);
  const input = (operation) => createActionInput(resource, operation, scopeInputValidator);
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

  const actions = [
    {
      operation: "list",
      kind: "query",
      idempotency: "none",
      execute: (value, context) => service.queryDocuments(
        omitInputKeys(value, scopeInputKeys),
        { context }
      )
    },
    {
      operation: "view",
      kind: "query",
      idempotency: "none",
      execute(value, context) {
        const query = omitInputKeys(value, [...scopeInputKeys, "recordId"]);
        return service.getDocumentById(value.recordId, query, { context });
      }
    },
    {
      operation: "create",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("created", ({ result }) => result?.data?.id ?? result?.value?.data?.id)],
      execute: (value, context) => service.createDocument(
        omitInputKeys(value, scopeInputKeys),
        { context }
      )
    },
    {
      operation: "update",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("updated", ({ input: value }) => value?.recordId)],
      execute(value, context) {
        const patch = omitInputKeys(value, [...scopeInputKeys, "recordId"]);
        return service.patchDocumentById(value.recordId, patch, { context });
      }
    },
    {
      operation: "delete",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("deleted", ({ input: value }) => value?.recordId)],
      execute: (value, context) => service.deleteDocumentById(
        value.recordId,
        { context }
      )
    }
  ];

  return Object.freeze(actions.map((definition) => {
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
      idempotency: definition.idempotency,
      audit: { actionName: id },
      observability: {},
      events: definition.events || [],
      execute: definition.execute
    });
  }));
}

function assertCrudOperationName(operation = "") {
  if (!CRUD_OPERATION_NAMES.includes(operation)) {
    throw new TypeError(`Unknown CRUD operation "${operation}".`);
  }
  return operation;
}

export { assertCrudOperationName, createCrudJsonApiActions };
