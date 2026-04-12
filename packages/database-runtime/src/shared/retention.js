import { toDatabaseDateTimeUtc } from "./dateUtils.js";
import { normalizeDbRecordId } from "./repositoryOptions.js";

function normalizeBatchSize(value, { fallback = 1000, max = 10_000 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeCutoffDateOrThrow(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid cutoff date.");
  }

  return parsed;
}

function normalizeDeletedRowCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

async function deleteRowsOlderThan({ client, tableName, dateColumn, cutoffDate, batchSize, applyFilters }) {
  const normalizedCutoff = toDatabaseDateTimeUtc(normalizeCutoffDateOrThrow(cutoffDate));
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  let query = client(tableName).where(dateColumn, "<", normalizedCutoff);
  if (typeof applyFilters === "function") {
    query = applyFilters(query);
  }

  const ids = await query.orderBy("id", "asc").limit(normalizedBatchSize).select("id");
  if (!Array.isArray(ids) || ids.length < 1) {
    return 0;
  }

  const recordIds = ids.map((entry) => normalizeDbRecordId(entry?.id)).filter(Boolean);
  if (recordIds.length < 1) {
    return 0;
  }

  const deleted = await client(tableName).whereIn("id", recordIds).del();
  return normalizeDeletedRowCount(deleted);
}

const __testables = {
  normalizeBatchSize,
  normalizeCutoffDateOrThrow,
  normalizeDeletedRowCount
};

export { normalizeBatchSize, normalizeCutoffDateOrThrow, normalizeDeletedRowCount, deleteRowsOlderThan, __testables };
