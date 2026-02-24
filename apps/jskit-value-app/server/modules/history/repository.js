import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";

function normalizeCount(row) {
  const values = Object.values(row || {});
  if (!values.length) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function mapCalculationRowRequired(row) {
  if (!row) {
    throw new TypeError("mapCalculationRowRequired expected a row object.");
  }

  const operation =
    String(row.deg2rad_operation || "DEG2RAD")
      .trim()
      .toUpperCase() || "DEG2RAD";
  const formula = String(row.deg2rad_formula || "DEG2RAD(x) = x * PI / 180").trim() || "DEG2RAD(x) = x * PI / 180";
  const degrees = row.deg2rad_degrees == null ? row.payment : row.deg2rad_degrees;
  const radians = row.deg2rad_radians == null ? row.value : row.deg2rad_radians;

  return {
    id: row.id,
    createdAt: toIsoString(row.created_at),
    DEG2RAD_operation: operation,
    DEG2RAD_formula: formula,
    DEG2RAD_degrees: degrees == null ? "0" : String(degrees),
    DEG2RAD_radians: radians == null ? "0" : String(radians)
  };
}

function createCalculationLogsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsert(workspaceId, userId, entry, options = {}) {
    const client = resolveClient(options);
    const fallbackDegrees = String(entry.DEG2RAD_degrees);
    const fallbackRadians = String(entry.DEG2RAD_radians);

    await client("calculation_logs").insert({
      id: entry.id,
      workspace_id: workspaceId,
      user_id: userId,
      created_at: toMysqlDateTimeUtc(entry.createdAt),
      mode: "pv",
      timing: "ordinary",
      payment: fallbackDegrees,
      annual_rate: "0",
      annual_growth_rate: "0",
      years: null,
      payments_per_year: 1,
      periodic_rate: "0",
      periodic_growth_rate: "0",
      total_periods: null,
      is_perpetual: false,
      value: fallbackRadians,
      deg2rad_operation: entry.DEG2RAD_operation,
      deg2rad_formula: entry.DEG2RAD_formula,
      deg2rad_degrees: fallbackDegrees,
      deg2rad_radians: fallbackRadians
    });
  }

  async function repoCountForWorkspaceUser(workspaceId, userId, options = {}) {
    const client = resolveClient(options);
    const row = await client("calculation_logs")
      .where({ workspace_id: workspaceId, user_id: userId })
      .count({ total: "*" })
      .first();
    return normalizeCount(row);
  }

  async function repoListForWorkspaceUser(workspaceId, userId, page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = (page - 1) * pageSize;

    const rows = await client("calculation_logs")
      .where({ workspace_id: workspaceId, user_id: userId })
      .orderBy("created_at", "desc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapCalculationRowRequired);
  }

  async function repoCountForWorkspace(workspaceId, options = {}) {
    const client = resolveClient(options);
    const row = await client("calculation_logs").where({ workspace_id: workspaceId }).count({ total: "*" }).first();
    return normalizeCount(row);
  }

  async function repoListForWorkspace(workspaceId, page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = (page - 1) * pageSize;

    const rows = await client("calculation_logs")
      .where({ workspace_id: workspaceId })
      .orderBy("created_at", "desc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapCalculationRowRequired);
  }

  return {
    insert: repoInsert,
    countForWorkspaceUser: repoCountForWorkspaceUser,
    listForWorkspaceUser: repoListForWorkspaceUser,
    countForWorkspace: repoCountForWorkspace,
    listForWorkspace: repoListForWorkspace
  };
}

const repository = createCalculationLogsRepository(db);

const __testables = {
  mapCalculationRowRequired,
  normalizeCount,
  createCalculationLogsRepository
};

export const { insert, countForWorkspaceUser, listForWorkspaceUser, countForWorkspace, listForWorkspace } = repository;
export { __testables };
