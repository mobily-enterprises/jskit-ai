import crypto from "node:crypto";
import { Value } from "typebox/value";
import { AppError } from "../../lib/errors.js";
import { schema } from "./schema.js";

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
  const operation = String(result?.DEG2RAD_operation || "DEG2RAD")
    .trim()
    .toUpperCase();
  const formula = String(result?.DEG2RAD_formula || "DEG2RAD(x) = x * PI / 180").trim();

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    DEG2RAD_operation: operation || "DEG2RAD",
    DEG2RAD_formula: formula || "DEG2RAD(x) = x * PI / 180",
    DEG2RAD_degrees: String(result?.DEG2RAD_degrees),
    DEG2RAD_radians: String(result?.DEG2RAD_radians)
  };
}

function assertValidHistoryEntry(historyEntry) {
  if (Value.Check(schema.entry, historyEntry)) {
    return;
  }

  const fieldErrors = mapSchemaErrorsToFieldErrors(Value.Errors(schema.entry, historyEntry));
  throw new AppError(500, "Internal history entry validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function createService(options) {
  const calculationLogsRepository = options.calculationLogsRepository;

  async function appendCalculation(workspaceId, userId, result, options = {}) {
    const historyEntry = buildHistoryEntryFromResult(result);
    assertValidHistoryEntry(historyEntry);

    await calculationLogsRepository.insert(workspaceId, userId, historyEntry, options);
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

export { createService, __testables };
