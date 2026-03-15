import {
  createActionRuntimeError,
  normalizeActionContributor,
  createActionVersionKey
} from "./actionDefinitions.js";
import { executeActionPipeline } from "./pipeline.js";

function normalizeContributors(contributors) {
  const source = Array.isArray(contributors) ? contributors : [];
  return source.map((entry) => normalizeActionContributor(entry));
}

function buildDefinitionIndex(contributors) {
  const definitions = [];
  const byVersionKey = new Map();
  const byActionId = new Map();

  for (const contributor of contributors) {
    for (const definition of contributor.actions) {
      const versionKey = createActionVersionKey(definition.id, definition.version);
      if (byVersionKey.has(versionKey)) {
        const existing = byVersionKey.get(versionKey);
        throw createActionRuntimeError(
          500,
          `Action definition \"${versionKey}\" is duplicated between contributors \"${existing.contributorId}\" and \"${contributor.contributorId}\".`,
          {
            code: "ACTION_DEFINITION_DUPLICATE"
          }
        );
      }

      byVersionKey.set(versionKey, definition);
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
    byActionId
  };
}

function normalizeRequestedVersion(version) {
  const parsed = Number(version);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createActionRuntimeError(400, "Validation failed.", {
      code: "ACTION_VERSION_INVALID",
      details: {
        fieldErrors: {
          version: "version must be an integer >= 1."
        }
      }
    });
  }

  return parsed;
}

function resolveActionDefinition(index, actionId, version) {
  const normalizedActionId = String(actionId || "").trim();
  if (!normalizedActionId) {
    throw createActionRuntimeError(400, "Validation failed.", {
      code: "ACTION_ID_REQUIRED",
      details: {
        fieldErrors: {
          actionId: "actionId is required."
        }
      }
    });
  }

  if (version == null) {
    const versions = index.byActionId.get(normalizedActionId) || [];
    if (versions.length < 1) {
      throw createActionRuntimeError(404, "Not found.", {
        code: "ACTION_NOT_FOUND",
        details: {
          actionId: normalizedActionId
        }
      });
    }

    return versions[0];
  }

  const normalizedVersion = normalizeRequestedVersion(version);
  const versionKey = createActionVersionKey(normalizedActionId, normalizedVersion);
  const definition = index.byVersionKey.get(versionKey);
  if (!definition) {
    throw createActionRuntimeError(404, "Not found.", {
      code: "ACTION_NOT_FOUND",
      details: {
        actionId: normalizedActionId,
        version: normalizedVersion
      }
    });
  }

  return definition;
}

function createActionRegistry({
  contributors = [],
  idempotencyAdapter,
  auditAdapter,
  observabilityAdapter,
  logger = console
} = {}) {
  const normalizedContributors = normalizeContributors(contributors);
  const index = buildDefinitionIndex(normalizedContributors);

  async function execute({ actionId, version = null, input = {}, context = {}, deps = {} } = {}) {
    const definition = resolveActionDefinition(index, actionId, version);
    const execution = await executeActionPipeline({
      definition,
      input,
      context,
      deps,
      idempotencyAdapter,
      auditAdapter,
      observabilityAdapter,
      logger
    });

    return execution.result;
  }

  async function executeStream({ actionId, version = null, input = {}, context = {}, deps = {} } = {}) {
    const definition = resolveActionDefinition(index, actionId, version);
    if (definition.kind !== "stream") {
      throw createActionRuntimeError(400, "Validation failed.", {
        code: "ACTION_STREAM_KIND_REQUIRED",
        details: {
          actionId: definition.id,
          version: definition.version,
          kind: definition.kind
        }
      });
    }

    const execution = await executeActionPipeline({
      definition,
      input,
      context,
      deps,
      idempotencyAdapter,
      auditAdapter,
      observabilityAdapter,
      logger
    });

    return execution.result;
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

const __testables = {
  normalizeContributors,
  buildDefinitionIndex,
  resolveActionDefinition
};

export { createActionRegistry, __testables };
