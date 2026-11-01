import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { RestApiWriteError } from "json-rest-api";
import { isJsonApiDocumentResult } from "@jskit-ai/http-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { ARCHITECTURE_ID_PATTERN } from "@jskit-ai/kernel/shared/capabilities";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  createJsonApiFieldsetsQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../listQueryValidators.js";
import { resolveCrudJsonApiEntityIdFromResult } from "../serviceEvents.js";
import { createCrudAssistantExtension } from "./assistantExtension.js";

const CRUD_OPERATION_NAMES = Object.freeze(["list", "view", "create", "update", "delete"]);
const CRUD_MUTATION_NAMES = new Set(["create", "update", "delete"]);
const CRUD_LIFECYCLE_PHASES = Object.freeze(["before", "execute", "after", "afterCommit"]);

function createActionInput(resource, operation, scopeInputValidator, listFilterQueryValidator, operationInputs) {
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
 * @param {readonly string[]} keys
 */
function omitInputKeys(input, keys) {
  const result = { ...(isRecord(input) ? input : {}) };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

function normalizeCrudOperationLifecycle(value) {
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

function createLifecycleContext(value) {
  const { operation, input, context, resource, repository, service, trx, result, standard } = value;
  return Object.freeze({
    operation,
    input,
    context,
    resource,
    repository,
    service,
    trx,
    ...(Object.hasOwn(value, "result") ? { result } : {}),
    ...(standard ? { standard } : {})
  });
}

function normalizeAdditionalActions(definitions, { namespace, surface, permissionForAction, scopeInputValidator }) {
  return Object.freeze(Object.entries(definitions).map(([name, definition]) => {
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
 * The standard and custom actions of one CRUD feature, from the options
 * defineCrudJsonApiFeature resolved.
 * @param {object} dependencies
 * @param {string} dependencies.namespace
 * @param {import("../types.js").CrudResourceDefinition} dependencies.resource
 * @param {import("../types.js").CrudRepository} dependencies.repository
 * @param {import("../types.js").CrudService} dependencies.service
 * @param {string} dependencies.surface
 * @param {(operation: string) => object} dependencies.permissionForOperation Also answers for each custom action's name.
 * @param {readonly string[]} dependencies.operations
 * @param {object | null} dependencies.scopeInputValidator
 * @param {readonly string[]} dependencies.scopeInputKeys
 * @param {object | null} dependencies.listFilterQueryValidator
 * @param {import("../types.js").CrudOperationLifecycle} dependencies.operationLifecycle What normalizeCrudOperationLifecycle returned.
 * @param {{ create?: object, update?: object }} dependencies.operationInputs
 * @param {Record<string, object>} dependencies.actions The feature's custom actions, by name.
 * @param {Record<string, unknown>} dependencies.dependencies The capabilities in the feature's `requires`, by local name.
 * @param {string} dependencies.realtimeAudience
 */
function createCrudJsonApiActions({
  namespace,
  resource,
  repository,
  service,
  surface,
  permissionForOperation,
  operations,
  scopeInputValidator,
  scopeInputKeys,
  listFilterQueryValidator,
  operationLifecycle,
  operationInputs,
  actions,
  dependencies,
  realtimeAudience
}) {
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
  const additionalActions = normalizeAdditionalActions(actions, {
    namespace,
    surface,
    permissionForAction: permissionForOperation,
    scopeInputValidator
  });

  function listDocuments(input, context) {
    return service.queryDocuments(omitInputKeys(input, scopeInputKeys), { context });
  }

  function viewDocument(input, context) {
    return service.getDocumentById(input.recordId, omitInputKeys(input, [...scopeInputKeys, "recordId"]), { context });
  }

  function createDocument(input, context, trx) {
    return service.createDocument(omitInputKeys(input, scopeInputKeys), { context, trx });
  }

  function updateDocument(input, context, trx) {
    return service.patchDocumentById(input.recordId, omitInputKeys(input, [...scopeInputKeys, "recordId"]), { context, trx });
  }

  function deleteDocument(input, context, trx) {
    return service.deleteDocumentById(input.recordId, { context, trx });
  }

  /**
   * An operation's result, checked where its events depend on it: a create
   * returns the created record as a JSON:API document result, as the service's
   * createDocument and a lifecycle's standard() do, since its created and
   * record-changed events read the record's id from it.
   * @param {string} operation
   * @param {unknown} result
   */
  function requireOperationResult(operation, result) {
    if (operation === "create" && !(isJsonApiDocumentResult(result) && resolveCrudJsonApiEntityIdFromResult({ result }))) {
      throw new TypeError(
        `CRUD ${namespace} create must return the created record as a JSON:API document result ` +
          "(returnJsonApiDocument), as createDocument() and a lifecycle's standard() do."
      );
    }
    return result;
  }

  /**
   * Runs one standard operation through the feature's lifecycle hooks for it, if any.
   * @param {string} operation
   * @param {object} input
   * @param {object} context
   * @param {(input: object, context: object, trx: object | null) => Promise<any>} runStandard
   */
  async function executeOperation(operation, input, context, runStandard) {
    const hooks = operationLifecycle[operation];
    if (!hooks) {
      return requireOperationResult(operation, await runStandard(input, context, null));
    }

    async function run(trx = null) {
      const base = { operation, input, context, resource, repository, service, trx };
      if (hooks.before) {
        await hooks.before(createLifecycleContext(base));
      }
      const standard = (nextInput = input) => runStandard(nextInput, context, trx);
      const result = requireOperationResult(operation, hooks.execute
        ? await hooks.execute(createLifecycleContext({ ...base, standard }))
        : await standard());
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
          input,
          context,
          resource,
          repository,
          service,
          trx: null,
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
      events: [],
      execute: (input, context) => executeOperation("list", input, context, listDocuments)
    },
    {
      operation: "view",
      kind: "query",
      idempotency: "none",
      events: [],
      execute: (input, context) => executeOperation("view", input, context, viewDocument)
    },
    {
      operation: "create",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("created", resolveCrudJsonApiEntityIdFromResult)],
      execute: (input, context) => executeOperation("create", input, context, createDocument)
    },
    {
      operation: "update",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("updated", ({ input }) => input.recordId)],
      execute: (input, context) => executeOperation("update", input, context, updateDocument)
    },
    {
      operation: "delete",
      kind: "command",
      idempotency: "optional",
      events: [mutationEvent("deleted", ({ input }) => input.recordId)],
      execute: (input, context) => executeOperation("delete", input, context, deleteDocument)
    }
  ];

  const enabledOperations = new Set(operations);
  const standardActions = standardDefinitions.filter((definition) => enabledOperations.has(definition.operation)).map((definition) => Object.freeze({
    id: `crud.${namespace}.${definition.operation}`,
    version: 1,
    kind: definition.kind,
    channels: ["api", "automation", "internal"],
    surfaces: [surface],
    permission: permissionForOperation(definition.operation),
    input: createActionInput(resource, definition.operation, scopeInputValidator, listFilterQueryValidator, operationInputs),
    output: null,
    extensions: Object.freeze({
      assistant: createCrudAssistantExtension(resource, namespace, definition.operation)
    }),
    idempotency: definition.idempotency,
    events: definition.events,
    execute: definition.execute
  }));
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
    execute: (input, context) => definition.execute(Object.freeze({ ...dependencies, input, context, resource, repository, service }))
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
