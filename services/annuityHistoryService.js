import crypto from "node:crypto";
import { Value } from "typebox/value";
import { AppError } from "../lib/errors.js";
import { HistoryEntrySchema } from "../lib/schemas/historyEntrySchema.js";

function mapSchemaErrorsToFieldErrors(schemaErrors) {
  const fieldErrors = {};

  for (const issue of schemaErrors) {
    const issuePath = String(issue.path ?? issue.instancePath ?? "");
    const field = issuePath.replace(/^\//, "").replace(/\//g, ".") || "historyEntry";

    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message || "Invalid value.";
    }
  }

  return fieldErrors;
}

function buildHistoryEntryFromResult(result) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mode: result.mode,
    timing: result.timing,
    payment: String(result.payment),
    annualRate: String(result.annualRate),
    annualGrowthRate: String(result.annualGrowthRate),
    years: result.years == null ? null : String(result.years),
    paymentsPerYear: result.paymentsPerYear,
    periodicRate: String(result.periodicRate),
    periodicGrowthRate: String(result.periodicGrowthRate),
    totalPeriods: result.totalPeriods == null ? null : String(result.totalPeriods),
    isPerpetual: result.isPerpetual,
    value: String(result.value)
  };
}

function assertValidHistoryEntry(historyEntry) {
  if (Value.Check(HistoryEntrySchema, historyEntry)) {
    return;
  }

  const fieldErrors = mapSchemaErrorsToFieldErrors(Value.Errors(HistoryEntrySchema, historyEntry));
  throw new AppError(500, "Internal history entry validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function createAnnuityHistoryService(options) {
  const calculationLogsRepository = options.calculationLogsRepository;

  async function appendCalculation(workspaceId, userId, result) {
    const historyEntry = buildHistoryEntryFromResult(result);
    assertValidHistoryEntry(historyEntry);

    await calculationLogsRepository.insert(workspaceId, userId, historyEntry);
    return historyEntry;
  }

  async function listForUser(workspaceId, user, pagination) {
    const total = await calculationLogsRepository.countForWorkspaceUser(workspaceId, user.id);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);

    const entries = (
      await calculationLogsRepository.listForWorkspaceUser(workspaceId, user.id, safePage, pagination.pageSize)
    ).map((entry) => ({
      ...entry,
      username: user.displayName
    }));

    return {
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  return {
    appendCalculation,
    listForUser
  };
}

const __testables = {
  buildHistoryEntryFromResult,
  assertValidHistoryEntry,
  mapSchemaErrorsToFieldErrors
};

export { createAnnuityHistoryService, __testables };
