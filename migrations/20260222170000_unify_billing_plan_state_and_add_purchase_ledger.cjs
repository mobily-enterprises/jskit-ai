const ASSIGNMENT_STATUSES = ["current", "upcoming", "past", "canceled"];

function toIsoNow() {
  return new Date().toISOString();
}

function toMysqlDateTimeUtc(dateLike = new Date()) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toISOString().slice(0, 23).replace("T", " ");
}

function addDays(dateLike, days) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseJsonObject(value) {
  if (value == null) {
    return {};
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? { items: value } : { ...value };
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Array.isArray(parsed) ? { items: parsed } : { ...parsed };
  } catch {
    return {};
  }
}

async function hasIndex(knex, tableName, indexName) {
  const databaseName =
    knex?.client?.config?.connection?.database ||
    (typeof knex?.client?.database === "function" ? knex.client.database() : null);
  if (!databaseName) {
    throw new Error("Unable to resolve database name for billing migration index introspection.");
  }
  const rows = await knex("information_schema.statistics")
    .select("INDEX_NAME")
    .where({
      table_schema: databaseName,
      table_name: tableName,
      index_name: indexName
    })
    .limit(1);
  return rows.length > 0;
}

async function addIndexIfMissing(knex, tableName, indexName, columns) {
  if (await hasIndex(knex, tableName, indexName)) {
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.index(columns, indexName);
  });
}

async function dropIndexIfExists(knex, tableName, indexName) {
  if (!(await hasIndex(knex, tableName, indexName))) {
    return;
  }
  await knex.raw(`ALTER TABLE ?? DROP INDEX ??`, [tableName, indexName]);
}

async function dropForeignKeyByColumnIfExists(knex, tableName, columnName) {
  const databaseName =
    knex?.client?.config?.connection?.database ||
    (typeof knex?.client?.database === "function" ? knex.client.database() : null);
  if (!databaseName) {
    throw new Error("Unable to resolve database name for billing migration FK introspection.");
  }
  const rows = await knex("information_schema.KEY_COLUMN_USAGE as kcu")
    .select("kcu.CONSTRAINT_NAME")
    .where("kcu.TABLE_SCHEMA", databaseName)
    .where("kcu.TABLE_NAME", tableName)
    .where("kcu.COLUMN_NAME", columnName)
    .whereNotNull("kcu.REFERENCED_TABLE_NAME");

  for (const row of rows) {
    const constraintName = String(row.CONSTRAINT_NAME || "").trim();
    if (!constraintName) {
      continue;
    }
    await knex.raw(`ALTER TABLE ?? DROP FOREIGN KEY ??`, [tableName, constraintName]);
  }
}

async function assertNoDuplicateAssignmentsByStatus(knex, status) {
  const rows = await knex("billing_plan_assignments")
    .select("billable_entity_id")
    .count({ count: "*" })
    .where({ status })
    .groupBy("billable_entity_id")
    .havingRaw("COUNT(*) > 1")
    .limit(10);

  if (rows.length > 0) {
    const examples = rows.map((row) => `${row.billable_entity_id}:${row.count}`).join(", ");
    throw new Error(`Migration invariant failed: multiple '${status}' assignments found (${examples}).`);
  }
}

async function assertNoNullAssignmentStatuses(knex) {
  const row = await knex("billing_plan_assignments")
    .count({ count: "*" })
    .whereNull("status")
    .first();
  if (Number(row?.count || 0) > 0) {
    throw new Error("Migration invariant failed: billing_plan_assignments.status contains NULL rows after backfill.");
  }
}

async function findCurrentAssignmentForEntity(knex, billableEntityId, trx) {
  const client = trx || knex;
  return client("billing_plan_assignments")
    .where({
      billable_entity_id: Number(billableEntityId),
      status: "current"
    })
    .orderBy("id", "asc")
    .first();
}

async function findUpcomingAssignmentForEntity(knex, billableEntityId, trx) {
  const client = trx || knex;
  return client("billing_plan_assignments")
    .where({
      billable_entity_id: Number(billableEntityId),
      status: "upcoming"
    })
    .orderBy("id", "asc")
    .first();
}

async function ensureAssignmentStatusColumn(knex) {
  const hasStatus = await knex.schema.hasColumn("billing_plan_assignments", "status");
  if (!hasStatus) {
    await knex.schema.alterTable("billing_plan_assignments", (table) => {
      table.enu("status", ASSIGNMENT_STATUSES).nullable().after("period_end_at");
    });
  }

  const hasSource = await knex.schema.hasColumn("billing_plan_assignments", "source");
  if (!hasSource) {
    await knex.schema.alterTable("billing_plan_assignments", (table) => {
      table.string("source", 32).notNullable().defaultTo("internal").after("plan_id");
    });
  }
}

async function backfillAssignmentStatusesFromIsCurrent(knex) {
  const hasIsCurrent = await knex.schema.hasColumn("billing_plan_assignments", "is_current");
  if (!hasIsCurrent) {
    return;
  }

  await knex("billing_plan_assignments")
    .whereNull("status")
    .update({
      status: knex.raw("CASE WHEN is_current = 1 THEN 'current' ELSE 'past' END")
    });
}

async function backfillCurrentAssignmentsFromSubscriptions(knex) {
  const hasSubscriptions = await knex.schema.hasTable("billing_subscriptions");
  if (!hasSubscriptions) {
    return;
  }

  const rows = await knex("billing_subscriptions")
    .select(
      "id",
      "billable_entity_id",
      "plan_id",
      "provider_subscription_created_at",
      "current_period_end",
      "trial_end",
      "created_at",
      "updated_at",
      "metadata_json",
      "is_current"
    )
    .where({ is_current: 1 })
    .orderBy("billable_entity_id", "asc")
    .orderBy("id", "asc");

  const migratedAt = toIsoNow();

  for (const row of rows) {
    await knex.transaction(async (trx) => {
      const currentAssignment = await findCurrentAssignmentForEntity(knex, row.billable_entity_id, trx);
      const periodStart =
        row.provider_subscription_created_at || row.created_at || row.updated_at || new Date();
      const periodEnd =
        row.current_period_end || row.trial_end || addDays(periodStart, 30);

      if (currentAssignment) {
        if (Number(currentAssignment.plan_id) !== Number(row.plan_id)) {
          throw new Error(
            `Migration invariant failed: entity ${row.billable_entity_id} has current assignment plan ${currentAssignment.plan_id} but current subscription plan ${row.plan_id}.`
          );
        }

        const mergedMetadata = {
          ...parseJsonObject(currentAssignment.metadata_json),
          migratedFrom: "billing_subscriptions",
          migratedAt,
          billingSubscriptionId: Number(row.id)
        };

        await trx("billing_plan_assignments").where({ id: currentAssignment.id }).update({
          metadata_json: JSON.stringify(mergedMetadata),
          updated_at: toMysqlDateTimeUtc(new Date())
        });
        return;
      }

      const subscriptionMetadata = parseJsonObject(row.metadata_json);
      const metadataJson = {
        ...subscriptionMetadata,
        migratedFrom: "billing_subscriptions",
        migratedAt,
        billingSubscriptionId: Number(row.id)
      };

      await trx("billing_plan_assignments").insert({
        billable_entity_id: Number(row.billable_entity_id),
        plan_id: Number(row.plan_id),
        source: "internal",
        period_start_at: toMysqlDateTimeUtc(periodStart),
        period_end_at: toMysqlDateTimeUtc(periodEnd),
        status: "current",
        metadata_json: JSON.stringify(metadataJson),
        created_at: toMysqlDateTimeUtc(row.created_at || new Date()),
        updated_at: toMysqlDateTimeUtc(row.updated_at || new Date())
      });
    });
  }
}

async function backfillUpcomingAssignmentsFromSchedules(knex) {
  const hasSchedules = await knex.schema.hasTable("billing_plan_change_schedules");
  if (!hasSchedules) {
    return;
  }

  const rows = await knex("billing_plan_change_schedules")
    .select("*")
    .where({ status: "pending" })
    .orderBy("billable_entity_id", "asc")
    .orderBy("id", "asc");

  const migratedAt = toIsoNow();

  for (const row of rows) {
    await knex.transaction(async (trx) => {
      const existingUpcoming = await findUpcomingAssignmentForEntity(knex, row.billable_entity_id, trx);
      const effectiveAt = row.effective_at || row.created_at || new Date();
      const derivedPeriodEnd = addDays(effectiveAt, 30);

      if (existingUpcoming) {
        const sameTarget =
          Number(existingUpcoming.plan_id) === Number(row.target_plan_id) &&
          String(existingUpcoming.period_start_at) === String(toMysqlDateTimeUtc(effectiveAt));
        if (!sameTarget) {
          throw new Error(
            `Migration invariant failed: entity ${row.billable_entity_id} has conflicting upcoming assignment for schedule ${row.id}.`
          );
        }

        const mergedMetadata = {
          ...parseJsonObject(existingUpcoming.metadata_json),
          migratedFrom: "billing_plan_change_schedules",
          migratedAt,
          scheduleId: Number(row.id)
        };

        await trx("billing_plan_assignments").where({ id: existingUpcoming.id }).update({
          metadata_json: JSON.stringify(mergedMetadata),
          updated_at: toMysqlDateTimeUtc(new Date())
        });
        return;
      }

      const scheduleMetadata = parseJsonObject(row.metadata_json);
      const metadataJson = {
        ...scheduleMetadata,
        migratedFrom: "billing_plan_change_schedules",
        migratedAt,
        scheduleId: Number(row.id),
        effectiveAtSource: "billing_plan_change_schedules.effective_at",
        periodEndDerived: "effective_at_plus_30d"
      };

      await trx("billing_plan_assignments").insert({
        billable_entity_id: Number(row.billable_entity_id),
        plan_id: Number(row.target_plan_id),
        source: row.change_kind === "promo_fallback" ? "promo" : "manual",
        period_start_at: toMysqlDateTimeUtc(effectiveAt),
        period_end_at: toMysqlDateTimeUtc(derivedPeriodEnd),
        status: "upcoming",
        metadata_json: JSON.stringify(metadataJson),
        created_at: toMysqlDateTimeUtc(row.created_at || new Date()),
        updated_at: toMysqlDateTimeUtc(row.updated_at || new Date())
      });
    });
  }
}

async function ensureAssignmentProviderDetailsTable(knex) {
  const hasTable = await knex.schema.hasTable("billing_plan_assignment_provider_details");
  if (hasTable) {
    return;
  }

  await knex.schema.createTable("billing_plan_assignment_provider_details", (table) => {
    table.bigInteger("billing_plan_assignment_id").unsigned().notNullable().primary();
    table.string("provider", 32).notNullable();
    table.string("provider_subscription_id", 191).notNullable();
    table.string("provider_customer_id", 191).nullable();
    table.string("provider_status", 64).nullable();
    table.dateTime("provider_subscription_created_at", { precision: 3 }).nullable();
    table.dateTime("current_period_end", { precision: 3 }).nullable();
    table.dateTime("trial_end", { precision: 3 }).nullable();
    table.dateTime("canceled_at", { precision: 3 }).nullable();
    table.boolean("cancel_at_period_end").notNullable().defaultTo(false);
    table.dateTime("ended_at", { precision: 3 }).nullable();
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("billing_plan_assignment_id").references("id").inTable("billing_plan_assignments").onDelete("CASCADE");
    table.unique(["provider", "provider_subscription_id"], "uq_bpad_provider_subscription");
    table.index(["provider", "provider_subscription_id"], "idx_bpad_provider_subscription");
    table.index(["provider", "provider_customer_id"], "idx_bpad_provider_customer");
    table.index(["provider_status", "current_period_end"], "idx_bpad_status_period_end");
  });
}

async function backfillAssignmentProviderDetails(knex) {
  const hasSubscriptions = await knex.schema.hasTable("billing_subscriptions");
  const hasProviderDetails = await knex.schema.hasTable("billing_plan_assignment_provider_details");
  if (!hasSubscriptions || !hasProviderDetails) {
    return;
  }

  const subscriptions = await knex("billing_subscriptions as bs")
    .leftJoin("billing_customers as bc", "bc.id", "bs.billing_customer_id")
    .select(
      "bs.*",
      "bc.provider_customer_id as resolved_provider_customer_id",
      "bc.provider as billing_customer_provider"
    )
    .where({ "bs.is_current": 1 })
    .orderBy("bs.billable_entity_id", "asc")
    .orderBy("bs.id", "asc");

  const migratedAt = toIsoNow();

  for (const row of subscriptions) {
    await knex.transaction(async (trx) => {
      const assignment = await findCurrentAssignmentForEntity(knex, row.billable_entity_id, trx);
      if (!assignment) {
        throw new Error(
          `Migration invariant failed: no current assignment exists for current subscription ${row.id} (entity ${row.billable_entity_id}).`
        );
      }
      if (Number(assignment.plan_id) !== Number(row.plan_id)) {
        throw new Error(
          `Migration invariant failed: provider details backfill plan mismatch for entity ${row.billable_entity_id} (assignment ${assignment.plan_id}, subscription ${row.plan_id}).`
        );
      }

      const providerCustomerId =
        row.resolved_provider_customer_id == null ? null : String(row.resolved_provider_customer_id);
      const metadataJson = {
        ...parseJsonObject(row.metadata_json),
        migratedFrom: "billing_subscriptions",
        migratedAt,
        billingSubscriptionId: Number(row.id)
      };

      const existingByProvider = await trx("billing_plan_assignment_provider_details")
        .where({
          provider: String(row.provider || "").trim().toLowerCase(),
          provider_subscription_id: String(row.provider_subscription_id || "")
        })
        .first();

      if (existingByProvider && Number(existingByProvider.billing_plan_assignment_id) !== Number(assignment.id)) {
        await trx("billing_plan_assignment_provider_details")
          .where({
            billing_plan_assignment_id: Number(existingByProvider.billing_plan_assignment_id)
          })
          .delete();
      }

      await trx("billing_plan_assignment_provider_details")
        .insert({
          billing_plan_assignment_id: Number(assignment.id),
          provider: String(row.provider || "").trim().toLowerCase(),
          provider_subscription_id: String(row.provider_subscription_id || ""),
          provider_customer_id: providerCustomerId,
          provider_status: row.status == null ? null : String(row.status),
          provider_subscription_created_at: row.provider_subscription_created_at
            ? toMysqlDateTimeUtc(row.provider_subscription_created_at)
            : null,
          current_period_end: row.current_period_end ? toMysqlDateTimeUtc(row.current_period_end) : null,
          trial_end: row.trial_end ? toMysqlDateTimeUtc(row.trial_end) : null,
          canceled_at: row.canceled_at ? toMysqlDateTimeUtc(row.canceled_at) : null,
          cancel_at_period_end: Boolean(row.cancel_at_period_end),
          ended_at: row.ended_at ? toMysqlDateTimeUtc(row.ended_at) : null,
          last_provider_event_created_at: row.last_provider_event_created_at
            ? toMysqlDateTimeUtc(row.last_provider_event_created_at)
            : null,
          last_provider_event_id: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
          metadata_json: JSON.stringify(metadataJson),
          created_at: toMysqlDateTimeUtc(row.created_at || new Date()),
          updated_at: toMysqlDateTimeUtc(row.updated_at || new Date())
        })
        .onConflict("billing_plan_assignment_id")
        .merge({
          provider: String(row.provider || "").trim().toLowerCase(),
          provider_subscription_id: String(row.provider_subscription_id || ""),
          provider_customer_id: providerCustomerId,
          provider_status: row.status == null ? null : String(row.status),
          provider_subscription_created_at: row.provider_subscription_created_at
            ? toMysqlDateTimeUtc(row.provider_subscription_created_at)
            : null,
          current_period_end: row.current_period_end ? toMysqlDateTimeUtc(row.current_period_end) : null,
          trial_end: row.trial_end ? toMysqlDateTimeUtc(row.trial_end) : null,
          canceled_at: row.canceled_at ? toMysqlDateTimeUtc(row.canceled_at) : null,
          cancel_at_period_end: Boolean(row.cancel_at_period_end),
          ended_at: row.ended_at ? toMysqlDateTimeUtc(row.ended_at) : null,
          last_provider_event_created_at: row.last_provider_event_created_at
            ? toMysqlDateTimeUtc(row.last_provider_event_created_at)
            : null,
          last_provider_event_id: row.last_provider_event_id == null ? null : String(row.last_provider_event_id),
          metadata_json: JSON.stringify(metadataJson),
          updated_at: toMysqlDateTimeUtc(new Date())
        });
    });
  }
}

async function ensureBillingPurchasesTable(knex) {
  const hasTable = await knex.schema.hasTable("billing_purchases");
  if (hasTable) {
    return;
  }

  await knex.schema.createTable("billing_purchases", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("workspace_id").unsigned().nullable();
    table.string("provider", 32).notNullable();
    table.string("purchase_kind", 64).notNullable();
    table.string("status", 32).notNullable().defaultTo("confirmed");
    table.bigInteger("amount_minor").unsigned().notNullable();
    table.string("currency", 3).notNullable();
    table.integer("quantity").unsigned().nullable().defaultTo(1);
    table.string("operation_key", 64).nullable();
    table.string("provider_customer_id", 191).nullable();
    table.string("provider_checkout_session_id", 191).nullable();
    table.string("provider_payment_id", 191).nullable();
    table.string("provider_invoice_id", 191).nullable();
    table.bigInteger("billing_event_id").unsigned().nullable();
    table.string("display_name", 255).nullable();
    table.json("metadata_json").nullable();
    table.string("dedupe_key", 256).notNullable();
    table.dateTime("purchased_at", { precision: 3 }).notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("SET NULL");
    table.foreign("billing_event_id").references("id").inTable("billing_events").onDelete("SET NULL");

    table.unique(["dedupe_key"], "uq_billing_purchases_dedupe");
    table.index(["billable_entity_id", "purchased_at"], "idx_billing_purchases_entity_purchased");
    table.index(["status", "purchased_at"], "idx_billing_purchases_status_purchased");
    table.index(["provider", "provider_payment_id"], "idx_billing_purchases_provider_payment");
    table.index(["provider", "provider_invoice_id"], "idx_billing_purchases_provider_invoice");
  });
}

async function validateProviderDetailsMappings(knex) {
  const hasProviderDetails = await knex.schema.hasTable("billing_plan_assignment_provider_details");
  if (!hasProviderDetails) {
    return;
  }

  const duplicateRows = await knex("billing_plan_assignment_provider_details")
    .select("provider", "provider_subscription_id")
    .count({ count: "*" })
    .groupBy("provider", "provider_subscription_id")
    .havingRaw("COUNT(*) > 1")
    .limit(10);
  if (duplicateRows.length > 0) {
    const sample = duplicateRows
      .map((row) => `${row.provider}:${row.provider_subscription_id}:${row.count}`)
      .join(", ");
    throw new Error(`Migration invariant failed: duplicate provider subscription mappings (${sample}).`);
  }
}

async function addAssignmentStatusConstraints(knex) {
  const hasCurrentKey = await knex.schema.hasColumn("billing_plan_assignments", "current_assignment_entity_key");
  if (!hasCurrentKey) {
    await knex.raw(`
      ALTER TABLE billing_plan_assignments
      ADD COLUMN current_assignment_entity_key BIGINT UNSIGNED
        GENERATED ALWAYS AS (CASE WHEN status = 'current' THEN billable_entity_id ELSE NULL END) STORED
    `);
  }

  const hasUpcomingKey = await knex.schema.hasColumn("billing_plan_assignments", "upcoming_assignment_entity_key");
  if (!hasUpcomingKey) {
    await knex.raw(`
      ALTER TABLE billing_plan_assignments
      ADD COLUMN upcoming_assignment_entity_key BIGINT UNSIGNED
        GENERATED ALWAYS AS (CASE WHEN status = 'upcoming' THEN billable_entity_id ELSE NULL END) STORED
    `);
  }

  if (!(await hasIndex(knex, "billing_plan_assignments", "uq_billing_plan_assignments_current_status_key"))) {
    await knex.raw(`
      ALTER TABLE billing_plan_assignments
      ADD UNIQUE INDEX uq_billing_plan_assignments_current_status_key (current_assignment_entity_key)
    `);
  }

  if (!(await hasIndex(knex, "billing_plan_assignments", "uq_billing_plan_assignments_upcoming_status_key"))) {
    await knex.raw(`
      ALTER TABLE billing_plan_assignments
      ADD UNIQUE INDEX uq_billing_plan_assignments_upcoming_status_key (upcoming_assignment_entity_key)
    `);
  }

  await addIndexIfMissing(
    knex,
    "billing_plan_assignments",
    "idx_billing_plan_assignments_entity_status",
    ["billable_entity_id", "status"]
  );
  await addIndexIfMissing(
    knex,
    "billing_plan_assignments",
    "idx_billing_plan_assignments_status_period_start",
    ["status", "period_start_at"]
  );
  await addIndexIfMissing(
    knex,
    "billing_plan_assignments",
    "idx_billing_plan_assignments_entity_period_end",
    ["billable_entity_id", "period_end_at"]
  );

  await knex.raw(`
    UPDATE billing_plan_assignments
    SET status = 'past'
    WHERE status IS NULL
  `);

  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    MODIFY COLUMN status ENUM('current','upcoming','past','canceled') NOT NULL
  `);
}

async function cleanupLegacyPlanStateColumns(knex) {
  const hasIsCurrent = await knex.schema.hasColumn("billing_plan_assignments", "is_current");
  if (hasIsCurrent) {
    await dropIndexIfExists(knex, "billing_plan_assignments", "uq_billing_plan_assignments_current_key");
    const hasCurrentAssignmentKey = await knex.schema.hasColumn("billing_plan_assignments", "current_assignment_key");
    if (hasCurrentAssignmentKey) {
      await knex.raw(`
        ALTER TABLE billing_plan_assignments
        DROP COLUMN current_assignment_key
      `);
    }
    await knex.schema.alterTable("billing_plan_assignments", (table) => {
      table.dropColumn("is_current");
    });
  }
}

async function cleanupLegacyPlanStateTables(knex) {
  const hasBillingEvents = await knex.schema.hasTable("billing_events");
  if (hasBillingEvents && (await knex.schema.hasColumn("billing_events", "schedule_id"))) {
    await dropForeignKeyByColumnIfExists(knex, "billing_events", "schedule_id");
    await knex.schema.alterTable("billing_events", (table) => {
      table.dropColumn("schedule_id");
    });
  }

  if (await knex.schema.hasTable("billing_plan_change_schedules")) {
    await knex.schema.dropTable("billing_plan_change_schedules");
  }

  if (await knex.schema.hasTable("billing_subscriptions")) {
    await knex.schema.dropTable("billing_subscriptions");
  }
}

exports.up = async function up(knex) {
  const hasAssignments = await knex.schema.hasTable("billing_plan_assignments");
  if (!hasAssignments) {
    throw new Error("Migration requires billing_plan_assignments to exist.");
  }

  await ensureAssignmentStatusColumn(knex);
  await backfillAssignmentStatusesFromIsCurrent(knex);
  await backfillCurrentAssignmentsFromSubscriptions(knex);
  await backfillUpcomingAssignmentsFromSchedules(knex);
  await ensureAssignmentProviderDetailsTable(knex);
  await backfillAssignmentProviderDetails(knex);
  await ensureBillingPurchasesTable(knex);

  await assertNoNullAssignmentStatuses(knex);
  await assertNoDuplicateAssignmentsByStatus(knex, "current");
  await assertNoDuplicateAssignmentsByStatus(knex, "upcoming");
  await validateProviderDetailsMappings(knex);

  await addAssignmentStatusConstraints(knex);
  await cleanupLegacyPlanStateColumns(knex);
  await cleanupLegacyPlanStateTables(knex);
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222170000_unify_billing_plan_state_and_add_purchase_ledger is irreversible.");
};
