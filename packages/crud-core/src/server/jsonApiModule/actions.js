import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { RestApiWriteError } from "json-rest-api";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { ARCHITECTURE_ID_PATTERN } from "@jskit-ai/kernel/shared/capabilities";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  createJsonApiFieldsetsQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../listQueryValidators.js";
import { createCrudAssistantExtension } from "./assistantExtension.js";

const CRUD_OPERATION_NAMES = Object.freeze(["list", "view", "create", "update", "delete"]);
const CRUD_MUTATION_NAMES = new Set(["create", "update", "delete"]);
const CRUD_LIFECYCLE_PHASES = Object.freeze(["before", "execute", "after", "afterCommit"]);

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

/**
 * @param {object} input
 * @param {readonly string[]} [keys]
 */
function omitInputKeys(input, keys = []) {
  const result = { ...(isRecord(input) ? input : {}) };
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
      // readable-check: allow method-probe - input validation: each operationLifecycle phase an application passes must be a function
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
    if (!ARCHITECTURE_ID_PATTERN.test(actionName)) {
      throw new TypeError(`CRUD custom action name "${actionName}" is invalid.`);
    }
    if (CRUD_OPERATION_NAMES.includes(actionName)) {
      throw new TypeError(`CRUD custom action name "${actionName}" is reserved.`);
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new TypeError(`CRUD custom action "${actionName}" must be an object.`);
    }
    // readable-check: allow method-probe - input validation: an application's custom action must have execute()
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
      events: definition.events || []
    });
  }));
}

/**
 * The standard and custom actions of one CRUD feature.
 * @param {object} dependencies
 * @param {string} dependencies.namespace
 * @param {object} dependencies.resource
 * @param {import("../types.js").CrudResourceApi["repository"]} dependencies.repository
 * @param {import("../types.js").CrudResourceApi["service"]} dependencies.service
 * @param {string} dependencies.surface
 * @param {(operation: string) => object} dependencies.permissionForOperation
 * @param {(actionName: string) => object} [dependencies.permissionForAction]
 * @param {readonly string[]} [dependencies.operations]
 * @param {object | null} [dependencies.scopeInputValidator]
 * @param {readonly string[]} [dependencies.scopeInputKeys]
 * @param {object | null} [dependencies.listFilterQueryValidator]
 * @param {Record<string, object>} [dependencies.operationLifecycle]
 * @param {{ create?: object, update?: object }} [dependencies.operationInputs]
 * @param {Record<string, object>} [dependencies.actions]
 * @param {Record<string, unknown>} [dependencies.dependencies]
 * @param {string} [dependencies.realtimeAudience]
 */
function createCrudJsonApiActions({
  namespace,
  resource,
  repository,
  service,
  surface,
  permissionForOperation,
  permissionForAction = permissionForOperation,
  operations = CRUD_OPERATION_NAMES,
  scopeInputValidator,
  scopeInputKeys = [],
  listFilterQueryValidator,
  operationLifecycle = {},
  operationInputs,
  actions: additionalActionDefinitions = {},
  dependencies = {},
  realtimeAudience = "event_scope"
}) {
  const actionId = (operation) => `crud.${namespace}.${operation}`;
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
      audience: realtimeAudience
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

    const result = CRUD_MUTATION_NAMES.has(operation) ? await repository.withTransaction(run) : await run();
    if (hooks.afterCommit) {
      try {
        await hooks.afterCommit(createLifecycleContext({
          operation,
          input: value,
          context,
          resource,
          repository,
          service,
          result
        }));
      } catch (error) {
        throw new RestApiWriteError(`CRUD ${operation} afterCommit hook failed.`, {
          cause: error,
          transactionOutcome: "committed"
        });
      }
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
