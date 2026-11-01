import { ActionRuntimeError, toActionVersionKey } from "./actionDefinitions.js";
import { executeActionPipeline } from "./pipeline.js";

/** @typedef {import("../types.js").ActionPolicy} ActionPolicy */
/** @typedef {import("../types.js").RuntimeEvents} RuntimeEvents */
/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */
/** @typedef {ReturnType<typeof import("./actionDefinitions.js").toRegisteredContributor>} RegisteredActionContributor */

/**
 * @param {ReadonlyArray<RegisteredActionContributor>} contributors
 */
function buildDefinitionIndex(contributors) {
  const definitions = [];
  const byVersionKey = new Map();
  const byActionId = new Map();
  const declaredByDefinition = new Map();

  for (const contributor of contributors) {
    for (const { definition, declared } of contributor.actions) {
      const versionKey = toActionVersionKey(definition.id, definition.version);
      if (byVersionKey.has(versionKey)) {
        const existing = byVersionKey.get(versionKey);
        throw new ActionRuntimeError(
          500,
          `Action definition \"${versionKey}\" is duplicated between contributors \"${existing.contributorId}\" and \"${contributor.contributorId}\".`,
          {
            code: "ACTION_DEFINITION_DUPLICATE"
          }
        );
      }

      byVersionKey.set(versionKey, definition);
      declaredByDefinition.set(definition, declared);
      definitions.push(definition);

      if (!byActionId.has(definition.id)) {
        byActionId.set(definition.id, []);
      }
      byActionId.get(definition.id).push(definition);
    }
  }

  for (const list of byActionId.values()) {
    list.sort((left, right) => right.version - left.version);
  }

  return {
    definitions: Object.freeze(definitions),
    byVersionKey,
    byActionId,
    declaredByDefinition
  };
}

function normalizeRequestedVersion(version) {
  const parsed = Number(version);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ActionRuntimeError(400, "Validation failed.", {
      code: "ACTION_VERSION_INVALID",
      details: {
        fieldErrors: {
          version: "version must be an integer >= 1."
        },
        fieldErrorCodes: {
          version: { code: "kernel.action.versionInvalid", params: {} }
        }
      }
    });
  }

  return parsed;
}

function resolveActionDefinition(index, actionId, version) {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId) {
    throw new ActionRuntimeError(400, "Validation failed.", {
      code: "ACTION_ID_REQUIRED",
      details: {
        fieldErrors: {
          actionId: "actionId is required."
        },
        fieldErrorCodes: {
          actionId: { code: "kernel.action.idRequired", params: {} }
        }
      }
    });
  }

  if (version == null) {
    const versions = index.byActionId.get(normalizedActionId) || [];
    if (versions.length < 1) {
      throw new ActionRuntimeError(404, "Not found.", {
        code: "ACTION_NOT_FOUND",
        details: {
          actionId: normalizedActionId
        }
      });
    }

    return versions[0];
  }

  const normalizedVersion = normalizeRequestedVersion(version);
  const versionKey = toActionVersionKey(normalizedActionId, normalizedVersion);
  const definition = index.byVersionKey.get(versionKey);
  if (!definition) {
    throw new ActionRuntimeError(404, "Not found.", {
      code: "ACTION_NOT_FOUND",
      details: {
        actionId: normalizedActionId,
        version: normalizedVersion
      }
    });
  }

  return definition;
}

/**
 * @param {object} dependencies
 * @param {ReadonlyArray<RegisteredActionContributor>} dependencies.contributors
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {ActionPolicy} dependencies.policy
 */
function createActionRegistry({
  contributors,
  events,
  logger,
  policy
}) {
  const index = buildDefinitionIndex(contributors);

  async function execute({ actionId, version, input, context, deps }) {
    const definition = resolveActionDefinition(index, actionId, version);
    return executeActionPipeline({
      definition,
      declared: index.declaredByDefinition.get(definition),
      input,
      context,
      deps,
      events,
      logger,
      policy
    });
  }

  async function executeStream({ actionId, version, input, context, deps }) {
    const definition = resolveActionDefinition(index, actionId, version);
    if (definition.kind !== "stream") {
      throw new ActionRuntimeError(400, "Validation failed.", {
        code: "ACTION_STREAM_KIND_REQUIRED",
        details: {
          actionId: definition.id,
          version: definition.version,
          kind: definition.kind
        }
      });
    }

    return executeActionPipeline({
      definition,
      declared: index.declaredByDefinition.get(definition),
      input,
      context,
      deps,
      events,
      logger,
      policy
    });
  }

  function listDefinitions() {
    return index.definitions.slice();
  }

  function getDefinition(actionId, version = null) {
    return resolveActionDefinition(index, actionId, version);
  }

  return Object.freeze({
    execute,
    executeStream,
    listDefinitions,
    getDefinition
  });
}

export { createActionRegistry };
