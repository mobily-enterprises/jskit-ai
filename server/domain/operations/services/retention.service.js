import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { normalizeBatchSize as normalizeRetentionBatchSize } from "../../../lib/primitives/retention.js";

const DEFAULT_ERROR_LOG_RETENTION_DAYS = 30;
const DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS = 90;
const DEFAULT_SECURITY_AUDIT_RETENTION_DAYS = 365;
const DEFAULT_RETENTION_BATCH_SIZE = 1000;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_BATCH_ITERATIONS = 50_000;

function normalizeRetentionDays(value, fallbackValue) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return fallbackValue;
  }

  return Math.min(parsed, 3650);
}

function normalizeBatchSize(value) {
  return normalizeRetentionBatchSize(value, {
    fallback: DEFAULT_RETENTION_BATCH_SIZE,
    max: 10_000
  });
}

function normalizeDateOrThrow(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid current time.");
  }

  return parsed;
}

function resolveCutoff(nowDate, retentionDays) {
  return new Date(nowDate.getTime() - retentionDays * DAY_IN_MILLISECONDS);
}

function resolveRetentionConfig(config = {}) {
  return {
    errorLogRetentionDays: normalizeRetentionDays(config.errorLogRetentionDays, DEFAULT_ERROR_LOG_RETENTION_DAYS),
    inviteArtifactRetentionDays: normalizeRetentionDays(
      config.inviteArtifactRetentionDays,
      DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS
    ),
    securityAuditRetentionDays: normalizeRetentionDays(
      config.securityAuditRetentionDays,
      DEFAULT_SECURITY_AUDIT_RETENTION_DAYS
    ),
    batchSize: normalizeBatchSize(config.batchSize)
  };
}

async function runBatchedDeletion({ deleteBatch, cutoffDate, batchSize }) {
  let totalDeletedRows = 0;
  let batches = 0;

  for (let index = 0; index < MAX_BATCH_ITERATIONS; index += 1) {
    const deletedRows = Number(await deleteBatch(cutoffDate, batchSize));
    const normalizedDeletedRows = Number.isFinite(deletedRows) && deletedRows > 0 ? deletedRows : 0;
    if (normalizedDeletedRows < 1) {
      break;
    }

    totalDeletedRows += normalizedDeletedRows;
    batches += 1;
    if (normalizedDeletedRows < batchSize) {
      break;
    }
  }

  return {
    totalDeletedRows,
    batches
  };
}

function createService({
  consoleErrorLogsRepository,
  workspaceInvitesRepository,
  consoleInvitesRepository,
  auditEventsRepository,
  retentionConfig,
  now = () => new Date()
}) {
  if (!consoleErrorLogsRepository || !workspaceInvitesRepository || !consoleInvitesRepository || !auditEventsRepository) {
    throw new Error("retention repositories are required.");
  }
  if (
    typeof consoleErrorLogsRepository.deleteBrowserErrorsOlderThan !== "function" ||
    typeof consoleErrorLogsRepository.deleteServerErrorsOlderThan !== "function"
  ) {
    throw new Error("consoleErrorLogsRepository retention methods are required.");
  }
  if (typeof workspaceInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("workspaceInvitesRepository.deleteArtifactsOlderThan is required.");
  }
  if (typeof consoleInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("consoleInvitesRepository.deleteArtifactsOlderThan is required.");
  }
  if (typeof auditEventsRepository.deleteOlderThan !== "function") {
    throw new Error("auditEventsRepository.deleteOlderThan is required.");
  }

  const config = resolveRetentionConfig(retentionConfig);

  async function runSweep({ dryRun = false, logger } = {}) {
    const nowDate = normalizeDateOrThrow(now());
    const rules = [
      {
        key: "console_browser_errors",
        retentionDays: config.errorLogRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          consoleErrorLogsRepository.deleteBrowserErrorsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "console_server_errors",
        retentionDays: config.errorLogRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          consoleErrorLogsRepository.deleteServerErrorsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "workspace_invites",
        retentionDays: config.inviteArtifactRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => workspaceInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "console_invites",
        retentionDays: config.inviteArtifactRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => consoleInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "security_audit_events",
        retentionDays: config.securityAuditRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => auditEventsRepository.deleteOlderThan(cutoffDate, batchSize)
      }
    ];

    const sweepSummary = [];
    for (const rule of rules) {
      const cutoffDate = resolveCutoff(nowDate, rule.retentionDays);
      if (dryRun) {
        sweepSummary.push({
          table: rule.key,
          retentionDays: rule.retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedRows: 0,
          batches: 0,
          dryRun: true
        });
        continue;
      }

      const deletion = await runBatchedDeletion({
        deleteBatch: rule.deleteBatch,
        cutoffDate,
        batchSize: config.batchSize
      });
      sweepSummary.push({
        table: rule.key,
        retentionDays: rule.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedRows: deletion.totalDeletedRows,
        batches: deletion.batches,
        dryRun: false
      });
    }

    const totalDeletedRows = sweepSummary.reduce((count, ruleSummary) => count + Number(ruleSummary.deletedRows || 0), 0);
    const result = {
      executedAt: nowDate.toISOString(),
      dryRun: Boolean(dryRun),
      batchSize: config.batchSize,
      totalDeletedRows,
      rules: sweepSummary
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
  DEFAULT_ERROR_LOG_RETENTION_DAYS,
  DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS,
  DEFAULT_SECURITY_AUDIT_RETENTION_DAYS,
  DEFAULT_RETENTION_BATCH_SIZE,
  DAY_IN_MILLISECONDS,
  normalizeRetentionDays,
  normalizeBatchSize,
  normalizeDateOrThrow,
  resolveCutoff,
  resolveRetentionConfig,
  runBatchedDeletion
};

export { createService, __testables };
