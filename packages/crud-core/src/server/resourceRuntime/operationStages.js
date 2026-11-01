import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function applyCrudRepositoryVirtualProjections(
  dbQuery,
  runtime = {},
  { knex, tableName } = {}
) {
  const virtualFields = Array.isArray(runtime.virtualFields) ? runtime.virtualFields : [];
  if (virtualFields.length < 1) {
    return dbQuery;
  }

  for (const virtualField of virtualFields) {
    virtualField.applyProjection(dbQuery, {
      knex,
      tableName,
      alias: virtualField.alias,
      fieldKey: virtualField.key
    });
  }

  return dbQuery;
}

/**
 * Runs an operation's applyQuery stage, which the compiled runtime holds as a function or null.
 * @param {object} dbQuery
 * @param {Function | null | undefined} stage
 * @param {object} stageContext
 * @param {{ context: string, stageKey: string }} labels
 */
function applyConfiguredQueryStage(dbQuery, stage, stageContext, { context, stageKey }) {
  if (!stage) {
    return {
      queryBuilder: dbQuery
    };
  }

  const directResult = stage(dbQuery, stageContext);
  if (directResult === undefined || directResult === dbQuery) {
    return {
      queryBuilder: dbQuery
    };
  }

  if (isCrudRepositoryQueryBuilder(directResult)) {
    return {
      queryBuilder: directResult
    };
  }

  // readable-check: allow method-probe - data: an application's query stage may return a promise
  if (directResult && typeof directResult.then === "function") {
    return Promise.resolve(directResult).then((awaitedResult) => {
      if (awaitedResult === undefined || awaitedResult === dbQuery) {
        return {
          queryBuilder: dbQuery
        };
      }

      if (isCrudRepositoryQueryBuilder(awaitedResult)) {
        throw new TypeError(
          `${context} ${stageKey} cannot return a query builder asynchronously. Mutate the provided builder and return undefined instead.`
        );
      }

      throw new TypeError(
        `${context} ${stageKey} must return undefined, the provided query builder, or another query builder synchronously.`
      );
    });
  }

  return Promise.reject(new TypeError(
    `${context} ${stageKey} must return undefined, the provided query builder, or another query builder synchronously.`
  ));
}

function isCrudRepositoryQueryBuilder(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function") || Array.isArray(value)) {
    return false;
  }

  return [
    "where",
    "whereIn",
    "select",
    "insert",
    "update",
    "delete",
    "del",
    "first",
    "modify"
    // readable-check: allow method-probe - platform object: a query stage's result is a query builder when it has one of its methods
  ].some((key) => typeof value[key] === "function");
}

/**
 * Runs an operation's payload stage, which the compiled runtime holds as a function or null.
 * @param {object} payload
 * @param {Function | null | undefined} stage
 * @param {object} stageContext
 * @param {{ context: string, stageKey: string }} labels
 */
async function applyConfiguredObjectStage(payload, stage, stageContext, { context, stageKey }) {
  const normalizedPayload = normalizeObject(payload);
  if (!stage) {
    return normalizedPayload;
  }

  const nextPayload = await stage(normalizedPayload, stageContext);
  if (nextPayload === undefined) {
    return normalizedPayload;
  }

  if (!nextPayload || typeof nextPayload !== "object" || Array.isArray(nextPayload)) {
    throw new TypeError(`${context} ${stageKey} must return an object when it returns a value.`);
  }

  return nextPayload;
}

function createCrudRepositoryActionContextBase(runtime, callOptions = {}) {
  return {
    runtime,
    repositoryOptions: runtime.repositoryOptions,
    callOptions,
    state: {}
  };
}

export {
  applyCrudRepositoryVirtualProjections,
  applyConfiguredQueryStage,
  applyConfiguredObjectStage,
  createCrudRepositoryActionContextBase
};
