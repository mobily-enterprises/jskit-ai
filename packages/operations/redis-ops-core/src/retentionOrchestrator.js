const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_BATCH_SIZE = 1000;
const MAX_RETENTION_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCH_ITERATIONS = 50_000;

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeRetentionDays(value, fallback = 30) {
  return normalizePositiveInteger(value, fallback, {
    max: 3650
  });
}

function normalizeRetentionHours(value, fallback = 24) {
  return normalizePositiveInteger(value, fallback, {
    max: 24 * 3650
  });
}

function normalizeRetentionBatchSize(value, fallback = DEFAULT_RETENTION_BATCH_SIZE) {
  return normalizePositiveInteger(value, fallback, {
    max: MAX_RETENTION_BATCH_SIZE
  });
}

function normalizeDateOrThrow(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid retention runtime date.");
  }

  return parsed;
}

function resolveCutoffDate(nowDate, retentionDays) {
  return new Date(nowDate.getTime() - retentionDays * DAY_IN_MILLISECONDS);
}

async function runBatchedDeletion({
  deleteBatch,
  cutoffDate,
  batchSize,
  maxIterations = DEFAULT_MAX_BATCH_ITERATIONS
} = {}) {
  if (typeof deleteBatch !== "function") {
    throw new TypeError("deleteBatch must be a function.");
  }

  const normalizedBatchSize = normalizeRetentionBatchSize(batchSize, DEFAULT_RETENTION_BATCH_SIZE);
  const normalizedMaxIterations = normalizePositiveInteger(maxIterations, DEFAULT_MAX_BATCH_ITERATIONS, {
    max: 1_000_000
  });

  let totalDeletedRows = 0;
  let batches = 0;

  for (let index = 0; index < normalizedMaxIterations; index += 1) {
    const deletedRows = Number(await deleteBatch(cutoffDate, normalizedBatchSize));
    const normalizedDeletedRows = Number.isFinite(deletedRows) && deletedRows > 0 ? deletedRows : 0;

    if (normalizedDeletedRows < 1) {
      break;
    }

    totalDeletedRows += normalizedDeletedRows;
    batches += 1;

    if (normalizedDeletedRows < normalizedBatchSize) {
      break;
    }
  }

  return {
    totalDeletedRows,
    batches
  };
}

function normalizeRuleDefinitions(rules) {
  const source = Array.isArray(rules) ? rules : [];
  const normalized = [];
  const seenIds = new Set();

  for (const rule of source) {
    const id = String(rule?.id || rule?.key || "").trim();
    if (!id) {
      throw new TypeError("Retention rule id is required.");
    }
    if (seenIds.has(id)) {
      throw new TypeError(`Retention rule "${id}" is duplicated.`);
    }

    const execute = rule?.execute;
    const deleteBatch = rule?.deleteBatch;
    if (typeof execute !== "function" && typeof deleteBatch !== "function") {
      throw new TypeError(`Retention rule "${id}" must provide execute or deleteBatch.`);
    }

    if (rule?.resolveRetentionDays != null && typeof rule.resolveRetentionDays !== "function") {
      throw new TypeError(`Retention rule "${id}" resolveRetentionDays must be a function when provided.`);
    }
    if (rule?.beforeExecute != null && typeof rule.beforeExecute !== "function") {
      throw new TypeError(`Retention rule "${id}" beforeExecute must be a function when provided.`);
    }
    if (rule?.afterExecute != null && typeof rule.afterExecute !== "function") {
      throw new TypeError(`Retention rule "${id}" afterExecute must be a function when provided.`);
    }
    if (rule?.buildDryRunMetadata != null && typeof rule.buildDryRunMetadata !== "function") {
      throw new TypeError(`Retention rule "${id}" buildDryRunMetadata must be a function when provided.`);
    }

    seenIds.add(id);
    normalized.push({
      id,
      retentionConfigKey: String(rule?.retentionConfigKey || "").trim(),
      retentionDays: rule?.retentionDays,
      resolveRetentionDays: rule?.resolveRetentionDays,
      execute,
      deleteBatch,
      beforeExecute: rule?.beforeExecute,
      afterExecute: rule?.afterExecute,
      buildDryRunMetadata: rule?.buildDryRunMetadata,
      maxIterations: rule?.maxIterations
    });
  }

  return normalized;
}

function resolveRuleRetentionDays({ rule, retentionConfig, nowDate, context }) {
  const config = retentionConfig && typeof retentionConfig === "object" ? retentionConfig : {};

  if (typeof rule.resolveRetentionDays === "function") {
    return normalizeRetentionDays(
      rule.resolveRetentionDays({
        retentionConfig: config,
        nowDate,
        context
      }),
      1
    );
  }

  if (rule.retentionConfigKey) {
    return normalizeRetentionDays(config[rule.retentionConfigKey], 1);
  }

  return normalizeRetentionDays(rule.retentionDays, 1);
}

function normalizeRuleDeletionResult(value) {
  if (!value || typeof value !== "object") {
    return {
      totalDeletedRows: 0,
      batches: 0
    };
  }

  return {
    totalDeletedRows: normalizePositiveInteger(value.totalDeletedRows, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER
    }),
    batches: normalizePositiveInteger(value.batches, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER
    })
  };
}

function createRetentionSweepOrchestrator({
  rules = [],
  retentionConfig = {},
  batchSize,
  now = () => new Date(),
  failFast = true
} = {}) {
  const normalizedRules = normalizeRuleDefinitions(rules);
  const normalizedRetentionConfig = retentionConfig && typeof retentionConfig === "object" ? retentionConfig : {};
  const normalizedBatchSize = normalizeRetentionBatchSize(
    batchSize == null ? normalizedRetentionConfig.batchSize : batchSize,
    DEFAULT_RETENTION_BATCH_SIZE
  );
  const shouldFailFast = normalizeBoolean(failFast, true);

  async function runSweep({ dryRun = false, logger = null, context = {} } = {}) {
    const nowDate = normalizeDateOrThrow(now());
    const summaries = [];
    let totalDeletedRows = 0;
    let failedRuleCount = 0;

    for (const rule of normalizedRules) {
      const retentionDays = resolveRuleRetentionDays({
        rule,
        retentionConfig: normalizedRetentionConfig,
        nowDate,
        context
      });
      const cutoffDate = resolveCutoffDate(nowDate, retentionDays);
      const summary = {
        ruleId: rule.id,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedRows: 0,
        batches: 0,
        dryRun: Boolean(dryRun),
        failed: false,
        error: null
      };

      if (dryRun) {
        if (typeof rule.buildDryRunMetadata === "function") {
          const dryRunMeta = await rule.buildDryRunMetadata({
            cutoffDate,
            batchSize: normalizedBatchSize,
            retentionDays,
            nowDate,
            retentionConfig: normalizedRetentionConfig,
            context
          });
          if (dryRunMeta != null) {
            summary.dryRunMeta = dryRunMeta;
          }
        }

        summaries.push(summary);
        continue;
      }

      try {
        if (typeof rule.beforeExecute === "function") {
          await rule.beforeExecute({
            cutoffDate,
            batchSize: normalizedBatchSize,
            retentionDays,
            nowDate,
            retentionConfig: normalizedRetentionConfig,
            context
          });
        }

        const deletion =
          typeof rule.execute === "function"
            ? await rule.execute({
                cutoffDate,
                batchSize: normalizedBatchSize,
                retentionDays,
                nowDate,
                retentionConfig: normalizedRetentionConfig,
                context,
                runBatchedDeletion
              })
            : await runBatchedDeletion({
                cutoffDate,
                batchSize: normalizedBatchSize,
                maxIterations: rule.maxIterations,
                deleteBatch: (innerCutoffDate, innerBatchSize) =>
                  rule.deleteBatch({
                    cutoffDate: innerCutoffDate,
                    batchSize: innerBatchSize,
                    retentionDays,
                    nowDate,
                    retentionConfig: normalizedRetentionConfig,
                    context
                  })
              });

        const normalizedDeletion = normalizeRuleDeletionResult(deletion);
        summary.deletedRows = normalizedDeletion.totalDeletedRows;
        summary.batches = normalizedDeletion.batches;
        totalDeletedRows += normalizedDeletion.totalDeletedRows;

        if (typeof rule.afterExecute === "function") {
          await rule.afterExecute({
            ...summary,
            cutoffDate,
            retentionDays,
            nowDate,
            retentionConfig: normalizedRetentionConfig,
            context
          });
        }
      } catch (error) {
        summary.failed = true;
        summary.error = {
          code: String(error?.code || "").trim() || null,
          message: String(error?.message || "Retention rule failed.")
        };
        failedRuleCount += 1;

        if (shouldFailFast) {
          throw error;
        }
      }

      summaries.push(summary);
    }

    const result = {
      executedAt: nowDate.toISOString(),
      dryRun: Boolean(dryRun),
      batchSize: normalizedBatchSize,
      totalDeletedRows,
      failedRuleCount,
      rules: summaries
    };

    if (logger && typeof logger.info === "function") {
      logger.info(result, "retention.sweep.completed");
    }

    return result;
  }

  return {
    runSweep
  };
}

const __testables = {
  DAY_IN_MILLISECONDS,
  DEFAULT_RETENTION_BATCH_SIZE,
  MAX_RETENTION_BATCH_SIZE,
  DEFAULT_MAX_BATCH_ITERATIONS,
  normalizePositiveInteger,
  normalizeBoolean,
  normalizeRetentionDays,
  normalizeRetentionHours,
  normalizeRetentionBatchSize,
  normalizeDateOrThrow,
  resolveCutoffDate,
  normalizeRuleDefinitions,
  resolveRuleRetentionDays,
  normalizeRuleDeletionResult
};

export {
  normalizeBoolean,
  normalizeRetentionDays,
  normalizeRetentionHours,
  normalizeRetentionBatchSize,
  resolveCutoffDate,
  runBatchedDeletion,
  createRetentionSweepOrchestrator,
  __testables
};
