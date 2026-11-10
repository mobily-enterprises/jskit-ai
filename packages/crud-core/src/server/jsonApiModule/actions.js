import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { RestApiWriteError } from "json-rest-api";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { ARCHITECTURE_ID_PATTERN } from "@jskit-ai/kernel/shared/capabilities";
import { ACTION_INPUT_DEFAULT_MODE } from "@jskit-ai/kernel/server/actions";
import {
  createIncludedFieldsetsCheck,
  createJsonApiFieldsetsQueryValidator,
  createStandardCrudListQueryValidators,
  createStandardCrudViewQueryValidators
} from "../listQueryValidators.js";
import { buildCrudRecordChangedEvent, resolveCrudJsonApiEntityIdFromResult } from "../serviceEvents.js";
import { createCrudAssistantExtension } from "./assistantExtension.js";
import { buildCrudCustomActionId } from "./customActionId.js";
import { withRemovedProperties } from "../removedApi.js";

const CRUD_OPERATION_NAMES = Object.freeze(["list", "view", "create", "update", "delete"]);
const CRUD_MUTATION_NAMES = new Set(["create", "update", "delete"]);
const CRUD_LIFECYCLE_PHASES = Object.freeze(["before", "execute", "after", "afterCommit"]);
const SERVED_ACTION_CHANNELS = Object.freeze(["api", "automation", "internal"]);
const UNSERVED_ACTION_CHANNELS = Object.freeze(["api", "internal"]);

/**
 * A CRUD action's channels. An action that no HTTP route serves and no permission guards stays
 * off the automation channel, so an assistant cannot reach records its user cannot reach over HTTP.
 * @param {{ require: string, permissions?: readonly string[] }} permission
 * @param {boolean} servedOverHttp
 */
function resolveCrudActionChannels(permission, servedOverHttp) {
  const guarded = ["all", "any"].includes(permission.require) && Array.isArray(permission.permissions) && permission.permissions.length > 0;
  return servedOverHttp || guarded ? SERVED_ACTION_CHANNELS : UNSERVED_ACTION_CHANNELS;
}

function buildActionInput(resource, operation, scopeInputValidator, listFilterQueryValidator, operationInputs) {
  const definitions = scopeInputValidator ? [scopeInputValidator] : [];
  // A fieldset for a type the includes reach below their first level is checked when the action runs (see
  // createIncludedFieldsetsCheck): only the tables they cross name that type, and every feature owns its tables at boot.
  if (operation === "list") {
    definitions.push(...createStandardCrudListQueryValidators({
      resource,
      listFilterQueryValidator,
      fieldsetsQueryValidator: createJsonApiFieldsetsQueryValidator({ resource, deferIncludedTypes: true })
    }));
  } else if (operation === "view") {
    definitions.push(recordIdParamsValidator, ...createStandardCrudViewQueryValidators({
      fieldsetsQueryValidator: createJsonApiFieldsetsQueryValidator({ resource, deferIncludedTypes: true })
    }));
  } else if (operation === "create") {
    definitions.push(operationInputs.create || resource.operations.create.body);
  } else if (operation === "update") {
    definitions.push(recordIdParamsValidator, operationInputs.update || resource.operations.patch.body);
  } else {
    definitions.push(recordIdParamsValidator);
  }

  // Only update changes part of a record; every other operation's input is strict.
  return composeSchemaDefinitions(definitions, { mode: operation === "update" ? "patch" : "create" });
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

// What a lifecycle hook's argument no longer carries.
const REMOVED_LIFECYCLE_PROPERTIES = Object.freeze({
  trx: "pass options, which carries the operation's transaction, to each repository call."
});

function buildLifecycleContext(value) {
  const { operation, input, context, options, resource, repository, service, result, standard } = value;
  return Object.freeze(withRemovedProperties({
    operation,
    input,
    context,
    options,
    resource,
    repository,
    service,
    ...(Object.hasOwn(value, "result") ? { result } : {}),
    ...(standard ? { standard } : {})
  }, REMOVED_LIFECYCLE_PROPERTIES, "A CRUD lifecycle hook's argument"));
}

function normalizeAdditionalActions(definitions, { namespace, surface, permissionForAction, scopeInputValidator, servedOverHttp }) {
  return Object.freeze(Object.entries(definitions).map(([name, definition]) => {
    const actionName = String(name || "").trim();
    if (!ARCHITECTURE_ID_PATTERN.test(actionName)) {
      throw new TypeError(
        `CRUD custom action name "${actionName}" is invalid: an action name is lower case, starts with a letter and ` +
          "holds only letters, digits, _, . and - (cancel-day, not cancelDay)."
      );
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
    if (Object.hasOwn(definition, "idempotency")) {
      throw new TypeError(`CRUD custom action "${actionName}" declares idempotency. Action definitions no longer declare idempotency.`);
    }

    const kind = definition.kind || "command";
    const permission = definition.permission || permissionForAction(actionName);
    return Object.freeze({
      ...definition,
      name: actionName,
      id: buildCrudCustomActionId(namespace, actionName, definition),
      version: definition.version || 1,
      kind,
      channels: definition.channels || resolveCrudActionChannels(permission, servedOverHttp),
      surfaces: definition.surfaces || [surface],
      permission,
      input: scopeInputValidator
        ? composeSchemaDefinitions([scopeInputValidator, definition.input], {
          mode: definition.input.mode || ACTION_INPUT_DEFAULT_MODE
        })
        : definition.input,
      events: definition.events || []
    });
  }));
}

/**
 * What a CRUD feature's actions take from its definition alone, so a feature builds it once and every composition
 * reuses it: each enabled standard operation's id, channels, permission, input and assistant extension, and the
 * feature's custom actions, checked and with the scope's input composed in.
 * @param {object} definition
 * @param {string} definition.namespace
 * @param {import("../types.js").CrudContract} definition.resource
 * @param {string} definition.surface
 * @param {(operation: string) => object} definition.permissionForOperation Also answers for each custom action's name.
 * @param {readonly string[]} definition.operations
 * @param {object | null} definition.scopeInputValidator
 * @param {object | null} definition.listFilterQueryValidator
 * @param {{ create?: object, update?: object }} definition.operationInputs
 * @param {Record<string, object>} definition.actions The feature's custom actions, by name.
 * @param {boolean} definition.servedOverHttp False when the feature is internal or registers no routes.
 */
function createCrudJsonApiActionDefinitions({
  namespace,
  resource,
  surface,
  permissionForOperation,
  operations,
  scopeInputValidator,
  listFilterQueryValidator,
  operationInputs,
  actions,
  servedOverHttp
}) {
  const additional = normalizeAdditionalActions(actions, {
    namespace,
    surface,
    permissionForAction: permissionForOperation,
    scopeInputValidator,
    servedOverHttp
  });
  const enabledOperations = new Set(operations);
  const standard = CRUD_OPERATION_NAMES.filter((operation) => enabledOperations.has(operation)).map((operation) => {
    const permission = permissionForOperation(operation);
    return Object.freeze({
      operation,
      id: `crud.${namespace}.${operation}`,
      channels: resolveCrudActionChannels(permission, servedOverHttp),
      surfaces: [surface],
      permission,
      input: buildActionInput(resource, operation, scopeInputValidator, listFilterQueryValidator, operationInputs),
      extensions: Object.freeze({
        assistant: createCrudAssistantExtension(resource, namespace, operation)
      })
    });
  });
  return Object.freeze({
    standard: Object.freeze(standard),
    additional
  });
}

/**
 * The standard and custom actions of one CRUD feature, from the options
 * defineCrudFeature resolved.
 * @param {object} dependencies
 * @param {string} dependencies.namespace
 * @param {import("../types.js").CrudContract} dependencies.resource
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
 * @param {boolean} dependencies.servedOverHttp False when the feature is internal or registers no routes.
 * @param {ReturnType<typeof createCrudJsonApiActionDefinitions>} [dependencies.definitions] What
 *   createCrudJsonApiActionDefinitions built from the same options, when the caller keeps it; built here otherwise.
 * @param {() => ReadonlyMap<string, ReadonlySet<string>>} [dependencies.includedTypes] The types the contract's
 *   includes reach below their first level, with the fields each shows there: the CRUD contracts' includedTypes once
 *   they are sealed. Without it, a list or view takes no fieldset for such a type.
 */
function createCrudJsonApiActions({
  namespace,
  resource,
  repository,
  service,
  scopeInputKeys,
  operationLifecycle,
  dependencies: actionDependencies,
  realtimeAudience,
  definitions: builtDefinitions,
  includedTypes = () => new Map(),
  ...definitionOptions
}) {
  const definitions = builtDefinitions ?? createCrudJsonApiActionDefinitions({ namespace, resource, ...definitionOptions });
  const checkIncludedFieldsets = createIncludedFieldsetsCheck(resource);
  const mutationEvent = (operation, entityId) => buildCrudRecordChangedEvent({
    namespace,
    operation,
    entityId,
    audience: realtimeAudience
  });

  // HTTP and automation callers keep the resource's page cap: a larger limit answers
  // pageLimits().request records, and the response's pagination reports the page size, hasMore
  // and the next cursor, as it always has. Server code asking for more gets an error instead.
  function listDocuments(input, options) {
    const query = omitInputKeys(input, scopeInputKeys);
    const pageLimit = repository.pageLimits().request;
    if (query.limit != null && Number(query.limit) > pageLimit) {
      query.limit = pageLimit;
    }
    return service.list(query, options);
  }

  function viewDocument(input, options) {
    return service.view(input.recordId, omitInputKeys(input, [...scopeInputKeys, "recordId"]), options);
  }

  function createDocument(input, options) {
    return service.create(omitInputKeys(input, scopeInputKeys), options);
  }

  function updateDocument(input, options) {
    return service.patch(input.recordId, omitInputKeys(input, [...scopeInputKeys, "recordId"]), options);
  }

  function deleteDocument(input, options) {
    return service.delete(input.recordId, options);
  }

  /**
   * An operation's result, checked where its events depend on it: a create
   * returns the created record, with its id, as a tagged JSON:API result of a
   * kind the HTTP transport encodes (returnJsonApiDocument, as the service's
   * create and a lifecycle's standard() do, or returnJsonApiData), since
   * its created and record-changed events read the record's id from it.
   * @param {string} operation
   * @param {unknown} result
   */
  function requireOperationResult(operation, result) {
    if (operation === "create" && !resolveCrudJsonApiEntityIdFromResult({ result })) {
      throw new TypeError(
        `CRUD ${namespace} create must return the created record, with its id, as a tagged JSON:API result ` +
          "(returnJsonApiDocument, as the CRUD service's create() and a lifecycle's standard() do, or returnJsonApiData)."
      );
    }
    return result;
  }

  /**
   * Runs one standard operation through the feature's lifecycle hooks for it, if any.
   * @param {string} operation
   * @param {object} input
   * @param {object} context
   * @param {(input: object, options: { context: object, trx?: object }) => Promise<any>} runStandard
   */
  async function executeOperation(operation, input, context, runStandard) {
    const hooks = operationLifecycle[operation];
    const callOptions = Object.freeze({ context });
    if (!hooks) {
      return requireOperationResult(operation, await runStandard(input, callOptions));
    }

    // A mutation's hooks and its standard operation share one transaction: the options they receive carry it.
    async function run(options) {
      const base = { operation, input, context, options, resource, repository, service };
      if (hooks.before) {
        await hooks.before(buildLifecycleContext(base));
      }
      const standard = (nextInput = input) => runStandard(nextInput, options);
      const result = requireOperationResult(operation, hooks.execute
        ? await hooks.execute(buildLifecycleContext({ ...base, standard }))
        : await standard());
      if (hooks.after) {
        await hooks.after(buildLifecycleContext({ ...base, result }));
      }
      return result;
    }

    const result = CRUD_MUTATION_NAMES.has(operation)
      ? await repository.withTransaction(callOptions, run)
      : await run(callOptions);
    if (hooks.afterCommit) {
      try {
        await hooks.afterCommit(buildLifecycleContext({
          operation,
          input,
          context,
          options: callOptions,
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
      events: [],
      execute: async (input, context) => {
        checkIncludedFieldsets(input.fields, includedTypes());
        return executeOperation("list", input, context, listDocuments);
      }
    },
    {
      operation: "view",
      kind: "query",
      events: [],
      execute: async (input, context) => {
        checkIncludedFieldsets(input.fields, includedTypes());
        return executeOperation("view", input, context, viewDocument);
      }
    },
    {
      operation: "create",
      kind: "command",
      events: [mutationEvent("created", resolveCrudJsonApiEntityIdFromResult)],
      execute: (input, context) => executeOperation("create", input, context, createDocument)
    },
    {
      operation: "update",
      kind: "command",
      events: [mutationEvent("updated", ({ input }) => input.recordId)],
      execute: (input, context) => executeOperation("update", input, context, updateDocument)
    },
    {
      operation: "delete",
      kind: "command",
      events: [mutationEvent("deleted", ({ input }) => input.recordId)],
      execute: (input, context) => executeOperation("delete", input, context, deleteDocument)
    }
  ];

  const standardActions = definitions.standard.map((built) => {
    const definition = standardDefinitions.find(({ operation }) => operation === built.operation);
    return Object.freeze({
      id: built.id,
      version: 1,
      kind: definition.kind,
      channels: built.channels,
      surfaces: [...built.surfaces],
      permission: built.permission,
      input: built.input,
      output: null,
      extensions: built.extensions,
      events: definition.events,
      execute: definition.execute
    });
  });
  const productActions = definitions.additional.map((definition) => Object.freeze({
    id: definition.id,
    version: definition.version,
    kind: definition.kind,
    channels: definition.channels,
    surfaces: definition.surfaces,
    input: definition.input,
    output: definition.output || null,
    permission: definition.permission,
    extensions: definition.extensions || {},
    events: definition.events,
    execute: (input, context) => definition.execute(Object.freeze({ ...actionDependencies, input, context, resource, repository, service }))
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
  createCrudJsonApiActionDefinitions,
  createCrudJsonApiActions,
  normalizeCrudOperationLifecycle
};
