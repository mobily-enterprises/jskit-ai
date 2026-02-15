import { db } from "../db/knex.js";
import { toIsoString } from "../lib/dateUtils.js";

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

  return {
    id: row.id,
    createdAt: toIsoString(row.created_at),
    mode: row.mode,
    timing: row.timing,
    payment: String(row.payment),
    annualRate: String(row.annual_rate),
    annualGrowthRate: String(row.annual_growth_rate),
    years: row.years == null ? null : String(row.years),
    paymentsPerYear: Number(row.payments_per_year),
    periodicRate: String(row.periodic_rate),
    periodicGrowthRate: String(row.periodic_growth_rate),
    totalPeriods: row.total_periods == null ? null : String(row.total_periods),
    isPerpetual: Boolean(row.is_perpetual),
    value: String(row.value)
  };
}

async function insert(userId, entry) {
  await db("calculation_logs").insert({
    id: entry.id,
    user_id: userId,
    created_at: entry.createdAt,
    mode: entry.mode,
    timing: entry.timing,
    payment: entry.payment,
    annual_rate: entry.annualRate,
    annual_growth_rate: entry.annualGrowthRate,
    years: entry.years,
    payments_per_year: entry.paymentsPerYear,
    periodic_rate: entry.periodicRate,
    periodic_growth_rate: entry.periodicGrowthRate,
    total_periods: entry.totalPeriods,
    is_perpetual: entry.isPerpetual,
    value: entry.value
  });
}

async function countForUser(userId) {
  const row = await db("calculation_logs").where({ user_id: userId }).count({ total: "*" }).first();
  return normalizeCount(row);
}

async function listForUser(userId, page, pageSize) {
  const offset = (page - 1) * pageSize;

  const rows = await db("calculation_logs")
    .where({ user_id: userId })
    .orderBy("created_at", "desc")
    .limit(pageSize)
    .offset(offset);

  return rows.map(mapCalculationRowRequired);
}

const __testables = {
  mapCalculationRowRequired,
  normalizeCount
};

export { insert, countForUser, listForUser, __testables };
