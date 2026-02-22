const LIFETIME_WINDOW_START_ISO = "1970-01-01T00:00:00.000Z";
const LIFETIME_WINDOW_END_ISO = "9999-12-31T23:59:59.999Z";

const DEFAULT_FREE_PLAN_TEMPLATES = Object.freeze([
  {
    code: "projects.max",
    amount: 3,
    grantKind: "plan_base",
    effectivePolicy: "on_assignment_current",
    durationPolicy: "while_current",
    durationDays: null,
    metadataJson: {
      source: "migration_default",
      planTier: "free"
    }
  },
  {
    code: "annuity.calculations.monthly",
    amount: 100,
    grantKind: "plan_base",
    effectivePolicy: "on_assignment_current",
    durationPolicy: "while_current",
    durationDays: null,
    metadataJson: {
      source: "migration_default",
      planTier: "free"
    }
  }
]);

const DEFAULT_PAID_PLAN_TEMPLATES = Object.freeze([
  {
    code: "projects.max",
    amount: 25,
    grantKind: "plan_base",
    effectivePolicy: "on_assignment_current",
    durationPolicy: "while_current",
    durationDays: null,
    metadataJson: {
      source: "migration_default",
      planTier: "paid"
    }
  },
  {
    code: "annuity.calculations.monthly",
    amount: 1000,
    grantKind: "plan_base",
    effectivePolicy: "on_assignment_current",
    durationPolicy: "while_current",
    durationDays: null,
    metadataJson: {
      source: "migration_default",
      planTier: "paid"
    }
  }
]);

const ENTITLEMENT_DEFINITION_SEEDS = Object.freeze([
  {
    code: "projects.max",
    name: "Projects Capacity",
    description: "Maximum active projects allowed for a billable entity.",
    entitlement_type: "capacity",
    unit: "project",
    window_interval: null,
    window_anchor: null,
    aggregation_mode: "sum",
    enforcement_mode: "hard_deny",
    scope_type: "billable_entity",
    is_active: 1,
    metadata_json: JSON.stringify({
      scaffold: true,
      capability: ["projects.create", "projects.unarchive"]
    })
  },
  {
    code: "annuity.calculations.monthly",
    name: "Annuity Calculations Monthly",
    description: "Monthly quota for annuity calculations.",
    entitlement_type: "metered_quota",
    unit: "calculation",
    window_interval: "month",
    window_anchor: "calendar_utc",
    aggregation_mode: "sum",
    enforcement_mode: "hard_deny",
    scope_type: "billable_entity",
    is_active: 1,
    metadata_json: JSON.stringify({
      scaffold: true,
      capability: ["annuity.calculate"]
    })
  }
]);

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function safeParseJson(value, fallback = null) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function ensureWindowBoundsOrThrow({ effectiveAt, expiresAt, context }) {
  if (!expiresAt) {
    return;
  }
  if (expiresAt.getTime() <= effectiveAt.getTime()) {
    throw new Error(`Invalid entitlement window: expires_at <= effective_at (${context}).`);
  }
}

function normalizePlanGrantKind(value) {
  const normalized = String(value || "plan_base")
    .trim()
    .toLowerCase();
  if (normalized === "plan_base" || normalized === "plan_bonus") {
    return normalized;
  }
  throw new Error(`Unsupported plan entitlement grantKind "${normalized}".`);
}

function normalizePlanEffectivePolicy(value) {
  const normalized = String(value || "on_assignment_current")
    .trim()
    .toLowerCase();
  if (normalized === "on_assignment_current" || normalized === "on_period_paid") {
    return normalized;
  }
  throw new Error(`Unsupported plan entitlement effectivePolicy "${normalized}".`);
}

function normalizePlanDurationPolicy(value) {
  const normalized = String(value || "while_current")
    .trim()
    .toLowerCase();
  if (normalized === "while_current" || normalized === "period_window" || normalized === "fixed_duration") {
    return normalized;
  }
  throw new Error(`Unsupported plan entitlement durationPolicy "${normalized}".`);
}

function normalizeProductGrantKind(value, { durationDays } = {}) {
  const normalizedInput = String(value || "")
    .trim()
    .toLowerCase();
  if (normalizedInput) {
    if (normalizedInput === "one_off_topup" || normalizedInput === "timeboxed_addon") {
      return normalizedInput;
    }
    throw new Error(`Unsupported product entitlement grantKind "${normalizedInput}".`);
  }
  return durationDays ? "timeboxed_addon" : "one_off_topup";
}

function resolveAmountFromPlanEntitlement(entry) {
  const valueJson = entry?.valueJson && typeof entry.valueJson === "object" ? entry.valueJson : {};
  const nestedValueJson = valueJson?.valueJson && typeof valueJson.valueJson === "object" ? valueJson.valueJson : {};
  const amountCandidates = [
    entry?.amount,
    valueJson.amount,
    valueJson.limit,
    valueJson.max,
    nestedValueJson.amount,
    nestedValueJson.limit,
    nestedValueJson.max
  ];
  for (const candidate of amountCandidates) {
    const normalized = toPositiveInteger(candidate);
    if (normalized) {
      return normalized;
    }
  }
  throw new Error(
    `Cannot derive entitlement amount for plan entitlement code "${String(entry?.code || "").trim()}" from valueJson.amount/limit/max.`
  );
}

function resolveDurationDaysOrThrow({ durationPolicy, durationDays, context }) {
  const parsedDurationDays = durationDays == null ? null : toPositiveInteger(durationDays);
  if (durationPolicy === "fixed_duration") {
    if (!parsedDurationDays) {
      throw new Error(`durationDays is required for fixed_duration (${context}).`);
    }
    return parsedDurationDays;
  }

  if (durationPolicy === "while_current" || durationPolicy === "period_window") {
    if (durationDays != null && parsedDurationDays == null) {
      throw new Error(`durationDays must be a positive integer when provided (${context}).`);
    }
    return null;
  }

  throw new Error(`Unsupported duration policy "${durationPolicy}" (${context}).`);
}

function parsePlanEdgeEntitlements(metadataJson) {
  const metadata = safeParseJson(metadataJson, {});
  const source = Array.isArray(metadata?.entitlements) ? metadata.entitlements : [];
  return source
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      code: String(entry.code || "").trim(),
      schemaVersion: String(entry.schemaVersion || "").trim(),
      valueJson: entry.valueJson && typeof entry.valueJson === "object" ? entry.valueJson : {},
      grantKind: entry.grantKind,
      effectivePolicy: entry.effectivePolicy,
      durationPolicy: entry.durationPolicy,
      durationDays: entry.durationDays,
      metadataJson: entry.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : null
    }))
    .filter((entry) => Boolean(entry.code));
}

function parseProductEdgeEntitlements(metadataJson) {
  const metadata = safeParseJson(metadataJson, {});
  const source = Array.isArray(metadata?.entitlements) ? metadata.entitlements : [];
  return source
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      code: String(entry.code || "").trim(),
      amount: toPositiveInteger(entry.amount),
      grantKind: entry.grantKind,
      durationDays: entry.durationDays == null ? null : toPositiveInteger(entry.durationDays),
      metadataJson: entry.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : null
    }))
    .filter((entry) => Boolean(entry.code));
}

function buildDefaultPlanTemplates(planRow) {
  const isFreePlan = String(planRow?.code || "").trim().toLowerCase() === "free";
  const isPaidPlan =
    Number(planRow?.checkout_unit_amount_minor || 0) > 0 &&
    String(planRow?.checkout_provider_price_id || "").trim().length > 0;

  if (isFreePlan || !isPaidPlan) {
    return DEFAULT_FREE_PLAN_TEMPLATES.map((entry) => ({
      ...entry
    }));
  }

  return DEFAULT_PAID_PLAN_TEMPLATES.map((entry) => ({
    ...entry
  }));
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfUtcMonthExclusive(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function resolveWindowForDefinition(definitionCode, now) {
  if (definitionCode === "annuity.calculations.monthly") {
    return {
      windowStartAt: startOfUtcMonth(now),
      windowEndAt: endOfUtcMonthExclusive(now)
    };
  }

  return {
    windowStartAt: new Date(LIFETIME_WINDOW_START_ISO),
    windowEndAt: new Date(LIFETIME_WINDOW_END_ISO)
  };
}

async function ensureRequiredTables(knex) {
  const requiredTableNames = [
    "billing_entitlement_definitions",
    "billing_plan_entitlement_templates",
    "billing_product_entitlement_templates",
    "billing_entitlement_grants",
    "billing_entitlement_consumptions",
    "billing_entitlement_balances",
    "billable_entities",
    "billing_plans",
    "billing_products"
  ];

  for (const tableName of requiredTableNames) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      throw new Error(`Migration requires table "${tableName}" to exist.`);
    }
  }
}

async function seedDefinitions(trx, now) {
  for (const definition of ENTITLEMENT_DEFINITION_SEEDS) {
    await trx("billing_entitlement_definitions")
      .insert({
        ...definition,
        created_at: now,
        updated_at: now
      })
      .onConflict("code")
      .merge({
        name: definition.name,
        description: definition.description,
        entitlement_type: definition.entitlement_type,
        unit: definition.unit,
        window_interval: definition.window_interval,
        window_anchor: definition.window_anchor,
        aggregation_mode: definition.aggregation_mode,
        enforcement_mode: definition.enforcement_mode,
        scope_type: definition.scope_type,
        is_active: definition.is_active,
        metadata_json: definition.metadata_json,
        updated_at: now
      });
  }

  const rows = await trx("billing_entitlement_definitions")
    .whereIn(
      "code",
      ENTITLEMENT_DEFINITION_SEEDS.map((entry) => entry.code)
    )
    .select("id", "code", "entitlement_type", "enforcement_mode");

  const byCode = new Map(rows.map((row) => [String(row.code), row]));
  for (const seed of ENTITLEMENT_DEFINITION_SEEDS) {
    if (!byCode.has(seed.code)) {
      throw new Error(`Failed to seed entitlement definition "${seed.code}".`);
    }
  }

  return byCode;
}

function normalizePlanTemplateFromEdge(edgeEntry, definitionByCode) {
  const code = String(edgeEntry?.code || "").trim();
  if (!code) {
    throw new Error("Plan entitlement code is required.");
  }
  const definition = definitionByCode.get(code);
  if (!definition) {
    throw new Error(`Unknown entitlement definition code "${code}".`);
  }

  const amount = resolveAmountFromPlanEntitlement(edgeEntry);
  const grantKind = normalizePlanGrantKind(edgeEntry?.grantKind);
  const effectivePolicy = normalizePlanEffectivePolicy(edgeEntry?.effectivePolicy);
  const durationPolicy = normalizePlanDurationPolicy(edgeEntry?.durationPolicy);
  const durationDays = resolveDurationDaysOrThrow({
    durationPolicy,
    durationDays: edgeEntry?.durationDays,
    context: `code=${code}`
  });

  return {
    entitlement_definition_id: Number(definition.id),
    amount,
    grant_kind: grantKind,
    effective_policy: effectivePolicy,
    duration_policy: durationPolicy,
    duration_days: durationDays,
    metadata_json: JSON.stringify({
      schemaVersion: String(edgeEntry?.schemaVersion || ""),
      valueJson: edgeEntry?.valueJson && typeof edgeEntry.valueJson === "object" ? edgeEntry.valueJson : {},
      metadataJson: edgeEntry?.metadataJson && typeof edgeEntry.metadataJson === "object" ? edgeEntry.metadataJson : null
    })
  };
}

function normalizeProductTemplateFromEdge(edgeEntry, definitionByCode) {
  const code = String(edgeEntry?.code || "").trim();
  if (!code) {
    throw new Error("Product entitlement code is required.");
  }
  const definition = definitionByCode.get(code);
  if (!definition) {
    throw new Error(`Unknown entitlement definition code "${code}".`);
  }
  const amount = toPositiveInteger(edgeEntry?.amount);
  if (!amount) {
    throw new Error(`Product entitlement "${code}" requires a positive integer amount.`);
  }

  const durationDays = edgeEntry?.durationDays == null ? null : toPositiveInteger(edgeEntry.durationDays);
  if (edgeEntry?.durationDays != null && !durationDays) {
    throw new Error(`Product entitlement "${code}" has invalid durationDays.`);
  }

  const grantKind = normalizeProductGrantKind(edgeEntry?.grantKind, {
    durationDays
  });
  if (grantKind === "one_off_topup" && durationDays != null) {
    throw new Error(`Product entitlement "${code}" one_off_topup cannot define durationDays.`);
  }
  if (grantKind === "timeboxed_addon" && !durationDays) {
    throw new Error(`Product entitlement "${code}" timeboxed_addon requires durationDays.`);
  }

  return {
    entitlement_definition_id: Number(definition.id),
    amount,
    grant_kind: grantKind,
    duration_days: grantKind === "timeboxed_addon" ? durationDays : null,
    metadata_json: JSON.stringify(edgeEntry?.metadataJson && typeof edgeEntry.metadataJson === "object" ? edgeEntry.metadataJson : {})
  };
}

async function replacePlanTemplates(trx, { planId, rows, now }) {
  await trx("billing_plan_entitlement_templates").where({ plan_id: Number(planId) }).del();
  if (rows.length < 1) {
    return;
  }
  const payload = rows.map((row) => ({
    plan_id: Number(planId),
    entitlement_definition_id: Number(row.entitlement_definition_id),
    amount: Number(row.amount),
    grant_kind: row.grant_kind,
    effective_policy: row.effective_policy,
    duration_policy: row.duration_policy,
    duration_days: row.duration_days == null ? null : Number(row.duration_days),
    metadata_json: row.metadata_json,
    created_at: now,
    updated_at: now
  }));
  await trx("billing_plan_entitlement_templates").insert(payload);
}

async function replaceProductTemplates(trx, { productId, rows, now }) {
  await trx("billing_product_entitlement_templates").where({ billing_product_id: Number(productId) }).del();
  if (rows.length < 1) {
    return;
  }
  const payload = rows.map((row) => ({
    billing_product_id: Number(productId),
    entitlement_definition_id: Number(row.entitlement_definition_id),
    amount: Number(row.amount),
    grant_kind: row.grant_kind,
    duration_days: row.duration_days == null ? null : Number(row.duration_days),
    metadata_json: row.metadata_json,
    created_at: now,
    updated_at: now
  }));
  await trx("billing_product_entitlement_templates").insert(payload);
}

function resolvePlanGrantWindow(templateRow, assignmentRow, effectiveAt) {
  const durationPolicy = String(templateRow.duration_policy || "while_current").trim().toLowerCase();
  const assignmentPeriodEnd = toDateOrNull(assignmentRow?.period_end_at);
  if (durationPolicy === "while_current" || durationPolicy === "period_window") {
    return assignmentPeriodEnd;
  }
  if (durationPolicy === "fixed_duration") {
    const durationDays = toPositiveInteger(templateRow?.duration_days);
    if (!durationDays) {
      throw new Error(`Plan template ${templateRow.id} fixed_duration requires duration_days.`);
    }
    return addUtcDays(effectiveAt, durationDays);
  }
  throw new Error(`Unsupported plan template duration policy "${durationPolicy}".`);
}

function resolveProductGrantWindow(templateRow, effectiveAt) {
  const grantKind = String(templateRow.grant_kind || "").trim().toLowerCase();
  if (grantKind === "one_off_topup") {
    return null;
  }
  if (grantKind === "timeboxed_addon") {
    const durationDays = toPositiveInteger(templateRow.duration_days);
    if (!durationDays) {
      throw new Error(`Product template ${templateRow.id} timeboxed_addon requires duration_days.`);
    }
    return addUtcDays(effectiveAt, durationDays);
  }
  throw new Error(`Unsupported product template grant_kind "${grantKind}".`);
}

function mapPlanTemplateGrantKindToGrantKind(templateGrantKind) {
  const normalized = String(templateGrantKind || "").trim().toLowerCase();
  if (normalized === "plan_base") {
    return "plan_base";
  }
  if (normalized === "plan_bonus") {
    return "promo";
  }
  throw new Error(`Unsupported plan template grant_kind "${normalized}".`);
}

function mapProductTemplateGrantKindToGrantKind(templateGrantKind) {
  const normalized = String(templateGrantKind || "").trim().toLowerCase();
  if (normalized === "one_off_topup") {
    return "topup";
  }
  if (normalized === "timeboxed_addon") {
    return "addon_timeboxed";
  }
  throw new Error(`Unsupported product template grant_kind "${normalized}".`);
}

async function insertGrantIdempotent(trx, payload) {
  await trx("billing_entitlement_grants")
    .insert(payload)
    .onConflict("dedupe_key")
    .ignore();
}

async function recomputeBalanceRow({
  trx,
  now,
  subjectId,
  workspaceId,
  definitionRow
}) {
  const definitionId = Number(definitionRow.id);
  const definitionCode = String(definitionRow.code || "");
  const entitlementType = String(definitionRow.entitlement_type || "");

  const { windowStartAt, windowEndAt } = resolveWindowForDefinition(definitionCode, now);

  const grantSumRow = await trx("billing_entitlement_grants")
    .where({
      subject_type: "billable_entity",
      subject_id: Number(subjectId),
      entitlement_definition_id: definitionId
    })
    .andWhere("effective_at", "<=", now)
    .andWhere((builder) => {
      builder.whereNull("expires_at").orWhere("expires_at", ">", now);
    })
    .sum({ total: "amount" })
    .first();
  const grantedAmount = Number(grantSumRow?.total || 0);

  let consumedAmount = 0;
  if (definitionCode === "projects.max") {
    if (toPositiveInteger(workspaceId)) {
      const activeProjectsRow = await trx("workspace_projects")
        .where({ workspace_id: Number(workspaceId) })
        .andWhereNot({ status: "archived" })
        .count({ total: "*" })
        .first();
      consumedAmount = Number(activeProjectsRow?.total || 0);
    }
  } else {
    const consumptionSumRow = await trx("billing_entitlement_consumptions")
      .where({
        subject_type: "billable_entity",
        subject_id: Number(subjectId),
        entitlement_definition_id: definitionId
      })
      .andWhere("occurred_at", ">=", windowStartAt)
      .andWhere("occurred_at", "<", windowEndAt)
      .sum({ total: "amount" })
      .first();
    consumedAmount = Number(consumptionSumRow?.total || 0);
  }

  const effectiveAmount = grantedAmount - consumedAmount;
  const hardLimitAmount =
    entitlementType === "capacity" || entitlementType === "metered_quota" ? grantedAmount : null;
  const overLimit =
    entitlementType === "balance" ? effectiveAmount < 0 : Number(consumedAmount) > Number(grantedAmount);
  const lockState = definitionCode === "projects.max" && overLimit ? "projects_locked_over_cap" : "none";

  const nextEffectiveRow = await trx("billing_entitlement_grants")
    .where({
      subject_type: "billable_entity",
      subject_id: Number(subjectId),
      entitlement_definition_id: definitionId
    })
    .andWhere("effective_at", ">", now)
    .min({ at: "effective_at" })
    .first();
  const nextExpiryRow = await trx("billing_entitlement_grants")
    .where({
      subject_type: "billable_entity",
      subject_id: Number(subjectId),
      entitlement_definition_id: definitionId
    })
    .whereNotNull("expires_at")
    .andWhere("expires_at", ">", now)
    .min({ at: "expires_at" })
    .first();

  const nextCandidates = [toDateOrNull(nextEffectiveRow?.at), toDateOrNull(nextExpiryRow?.at)].filter(Boolean);
  const nextChangeAt =
    nextCandidates.length > 0
      ? nextCandidates.sort((left, right) => left.getTime() - right.getTime())[0]
      : null;

  const balancePayload = {
    subject_type: "billable_entity",
    subject_id: Number(subjectId),
    entitlement_definition_id: definitionId,
    window_start_at: windowStartAt,
    window_end_at: windowEndAt,
    granted_amount: grantedAmount,
    consumed_amount: consumedAmount,
    effective_amount: effectiveAmount,
    hard_limit_amount: hardLimitAmount,
    over_limit: overLimit ? 1 : 0,
    lock_state: lockState,
    next_change_at: nextChangeAt,
    last_recomputed_at: now,
    metadata_json: JSON.stringify({
      seededByMigration: "20260222232000_backfill_billing_entitlements_engine"
    }),
    updated_at: now
  };

  await trx("billing_entitlement_balances")
    .insert({
      ...balancePayload,
      version: 0,
      created_at: now
    })
    .onConflict(["subject_type", "subject_id", "entitlement_definition_id", "window_start_at", "window_end_at"])
    .merge(balancePayload);
}

exports.up = async function up(knex) {
  await ensureRequiredTables(knex);

  const now = new Date();
  await knex.transaction(async (trx) => {
    const definitionByCode = await seedDefinitions(trx, now);

    const plans = await trx("billing_plans").select(
      "id",
      "code",
      "is_active",
      "metadata_json",
      "checkout_provider_price_id",
      "checkout_unit_amount_minor"
    );

    for (const plan of plans) {
      const sourceEdgeEntitlements = parsePlanEdgeEntitlements(plan.metadata_json);
      const templateSource =
        sourceEdgeEntitlements.length > 0 ? sourceEdgeEntitlements : buildDefaultPlanTemplates(plan);
      const normalizedRows = templateSource.map((entry) =>
        normalizePlanTemplateFromEdge(entry, definitionByCode)
      );

      if (Number(plan.is_active) === 1 && normalizedRows.length < 1) {
        throw new Error(`Active plan "${String(plan.code || "")}" has no entitlement template coverage.`);
      }

      await replacePlanTemplates(trx, {
        planId: plan.id,
        rows: normalizedRows,
        now
      });
    }

    const products = await trx("billing_products").select(
      "id",
      "code",
      "provider",
      "provider_price_id",
      "metadata_json",
      "is_active"
    );

    for (const product of products) {
      const edgeEntitlements = parseProductEdgeEntitlements(product.metadata_json);
      const existingRows = await trx("billing_product_entitlement_templates")
        .where({ billing_product_id: Number(product.id) })
        .select("id");
      const isEntitlementGrantingProduct = existingRows.length > 0 || edgeEntitlements.length > 0;

      if (edgeEntitlements.length > 0) {
        const normalizedRows = edgeEntitlements.map((entry) =>
          normalizeProductTemplateFromEdge(entry, definitionByCode)
        );
        await replaceProductTemplates(trx, {
          productId: product.id,
          rows: normalizedRows,
          now
        });
      }

      const finalRows = await trx("billing_product_entitlement_templates")
        .where({ billing_product_id: Number(product.id) })
        .select("id");

      if (isEntitlementGrantingProduct && finalRows.length < 1) {
        throw new Error(`Entitlement-granting product "${String(product.code || "")}" has zero template rows.`);
      }
    }

    const planTemplates = await trx("billing_plan_entitlement_templates").select(
      "id",
      "plan_id",
      "entitlement_definition_id",
      "amount",
      "grant_kind",
      "duration_policy",
      "duration_days",
      "metadata_json"
    );
    const planTemplatesByPlanId = new Map();
    for (const row of planTemplates) {
      const key = Number(row.plan_id);
      const current = planTemplatesByPlanId.get(key) || [];
      current.push(row);
      planTemplatesByPlanId.set(key, current);
    }

    const currentAssignments = await trx("billing_plan_assignments")
      .where({ status: "current" })
      .select("id", "billable_entity_id", "plan_id", "period_start_at", "period_end_at", "status");

    for (const assignment of currentAssignments) {
      const templates = planTemplatesByPlanId.get(Number(assignment.plan_id)) || [];
      for (const templateRow of templates) {
        const effectiveAt = toDateOrNull(assignment.period_start_at) || now;
        const expiresAt = resolvePlanGrantWindow(templateRow, assignment, effectiveAt);
        ensureWindowBoundsOrThrow({
          effectiveAt,
          expiresAt,
          context: `plan_assignment:${assignment.id}:template:${templateRow.id}`
        });

        await insertGrantIdempotent(trx, {
          subject_type: "billable_entity",
          subject_id: Number(assignment.billable_entity_id),
          entitlement_definition_id: Number(templateRow.entitlement_definition_id),
          amount: Number(templateRow.amount),
          kind: mapPlanTemplateGrantKindToGrantKind(templateRow.grant_kind),
          effective_at: effectiveAt,
          expires_at: expiresAt,
          source_type: "plan_assignment",
          source_id: Number(assignment.id),
          operation_key: null,
          provider: null,
          provider_event_id: null,
          dedupe_key: `mig:plan:${Number(assignment.id)}:template:${Number(templateRow.id)}`,
          metadata_json: JSON.stringify({
            seededByMigration: "20260222232000_backfill_billing_entitlements_engine",
            templateId: Number(templateRow.id)
          }),
          created_at: now
        });
      }
    }

    const productsByProviderPrice = new Map();
    for (const product of products) {
      const provider = String(product.provider || "").trim().toLowerCase();
      const providerPriceId = String(product.provider_price_id || "").trim();
      if (!provider || !providerPriceId) {
        continue;
      }
      productsByProviderPrice.set(`${provider}:${providerPriceId}`, Number(product.id));
    }

    const productTemplates = await trx("billing_product_entitlement_templates").select(
      "id",
      "billing_product_id",
      "entitlement_definition_id",
      "amount",
      "grant_kind",
      "duration_days"
    );
    const productTemplatesByProductId = new Map();
    for (const row of productTemplates) {
      const key = Number(row.billing_product_id);
      const current = productTemplatesByProductId.get(key) || [];
      current.push(row);
      productTemplatesByProductId.set(key, current);
    }

    const purchases = await trx("billing_purchases")
      .where({ status: "confirmed" })
      .select("id", "billable_entity_id", "provider", "metadata_json", "purchased_at");

    for (const purchase of purchases) {
      const metadata = safeParseJson(purchase.metadata_json, {});
      const providerPriceId = toNullableString(metadata?.providerPriceId);
      const provider = String(purchase.provider || "").trim().toLowerCase();
      if (!providerPriceId || !provider) {
        continue;
      }
      const productId = productsByProviderPrice.get(`${provider}:${providerPriceId}`) || null;
      if (!productId) {
        continue;
      }
      const templates = productTemplatesByProductId.get(Number(productId)) || [];
      for (const templateRow of templates) {
        const effectiveAt = toDateOrNull(purchase.purchased_at) || now;
        const expiresAt = resolveProductGrantWindow(templateRow, effectiveAt);
        ensureWindowBoundsOrThrow({
          effectiveAt,
          expiresAt,
          context: `purchase:${purchase.id}:template:${templateRow.id}`
        });

        await insertGrantIdempotent(trx, {
          subject_type: "billable_entity",
          subject_id: Number(purchase.billable_entity_id),
          entitlement_definition_id: Number(templateRow.entitlement_definition_id),
          amount: Number(templateRow.amount),
          kind: mapProductTemplateGrantKindToGrantKind(templateRow.grant_kind),
          effective_at: effectiveAt,
          expires_at: expiresAt,
          source_type: "billing_purchase",
          source_id: Number(purchase.id),
          operation_key: null,
          provider: provider,
          provider_event_id: null,
          dedupe_key: `mig:purchase:${Number(purchase.id)}:template:${Number(templateRow.id)}`,
          metadata_json: JSON.stringify({
            seededByMigration: "20260222232000_backfill_billing_entitlements_engine",
            templateId: Number(templateRow.id)
          }),
          created_at: now
        });
      }
    }

    const billableEntities = await trx("billable_entities").select("id", "workspace_id");
    const seededDefinitions = await trx("billing_entitlement_definitions")
      .whereIn(
        "code",
        ENTITLEMENT_DEFINITION_SEEDS.map((entry) => entry.code)
      )
      .select("id", "code", "entitlement_type");

    for (const entity of billableEntities) {
      for (const definitionRow of seededDefinitions) {
        await recomputeBalanceRow({
          trx,
          now,
          subjectId: Number(entity.id),
          workspaceId: entity.workspace_id == null ? null : Number(entity.workspace_id),
          definitionRow
        });
      }
    }
  });
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222232000_backfill_billing_entitlements_engine is irreversible.");
};
