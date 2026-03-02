import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const baselineMigration = require("../migrations/20260224000000_baseline_schema.cjs");
const alertsForwardMigration = require("../migrations/20260225000000_create_user_alerts_forward.cjs");
const { BASELINE_STEP_FILES, createBaselineRunner } = baselineMigration.__testables;

function createNoopColumnBuilder() {
  const builder = {
    unsigned() {
      return builder;
    },
    notNullable() {
      return builder;
    },
    nullable() {
      return builder;
    },
    primary() {
      return builder;
    },
    defaultTo() {
      return builder;
    },
    references() {
      return builder;
    },
    inTable() {
      return builder;
    },
    onDelete() {
      return builder;
    }
  };
  return builder;
}

function createNoopTableBuilder() {
  return {
    bigIncrements() {
      return createNoopColumnBuilder();
    },
    bigInteger() {
      return createNoopColumnBuilder();
    },
    string() {
      return createNoopColumnBuilder();
    },
    json() {
      return createNoopColumnBuilder();
    },
    dateTime() {
      return createNoopColumnBuilder();
    },
    foreign() {
      return createNoopColumnBuilder();
    },
    index() {}
  };
}

function createMigrationKnexDouble(existingTables = []) {
  const tableSet = new Set(existingTables);
  const createdTables = [];
  const rawStatements = [];

  const knex = {
    schema: {
      async hasTable(tableName) {
        return tableSet.has(tableName);
      },
      async hasColumn(tableName, columnName) {
        return tableSet.has(tableName) && String(columnName || "").trim() === "updated_at";
      },
      async createTable(tableName, callback) {
        createdTables.push(tableName);
        tableSet.add(tableName);
        callback(createNoopTableBuilder());
      }
    },
    raw(statement) {
      rawStatements.push(String(statement || ""));
      return statement;
    }
  };

  return {
    knex,
    createdTables,
    rawStatements
  };
}

test("baseline migration contains the full historical step sequence in order", () => {
  assert.equal(BASELINE_STEP_FILES[0], "20260215120000_create_user_profiles.cjs");
  assert.equal(BASELINE_STEP_FILES[BASELINE_STEP_FILES.length - 1], "20260225100000_create_social_federation_tables.cjs");
  assert.ok(BASELINE_STEP_FILES.includes("20260219120000_create_workspace_projects.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260223100000_add_deg2rad_columns_to_calculation_logs.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260223090000_enforce_unique_workspace_room_thread.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260223170000_add_billing_purchase_adjustments.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260224010000_create_user_alerts.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260225100000_create_social_federation_tables.cjs"));
});

test("baseline runner invokes each migration up step in order", async () => {
  const calls = [];
  const runner = createBaselineRunner({
    stepFiles: ["001_first.cjs", "002_second.cjs", "003_third.cjs"],
    loadMigration(stepFile) {
      return {
        async up(knex) {
          calls.push([stepFile, knex]);
        }
      };
    }
  });

  const knex = { marker: "knex-stub" };
  await runner.runUp(knex);

  assert.deepEqual(calls, [
    ["001_first.cjs", knex],
    ["002_second.cjs", knex],
    ["003_third.cjs", knex]
  ]);
});

test("baseline runner fails when a step does not export up()", async () => {
  const runner = createBaselineRunner({
    stepFiles: ["001_missing_up.cjs"],
    loadMigration() {
      return {};
    }
  });

  await assert.rejects(() => runner.runUp({}), /is missing up\(\)\./);
});

test("baseline runner fails when migration module is invalid", async () => {
  const runner = createBaselineRunner({
    stepFiles: ["001_invalid_module.cjs"],
    loadMigration() {
      return null;
    }
  });

  await assert.rejects(() => runner.runUp({}), /did not export a migration module\./);
});

test("baseline migration down is irreversible", async () => {
  await assert.rejects(
    () => baselineMigration.down({}),
    /Migration 20260224000000_baseline_schema is irreversible\./
  );
});

test("alerts forward migration creates alerts tables when missing", async () => {
  const { knex, createdTables, rawStatements } = createMigrationKnexDouble();

  await alertsForwardMigration.up(knex);

  assert.deepEqual(createdTables, ["user_alerts", "user_alert_states"]);
  const alterStatements = rawStatements.filter((statement) => /ALTER TABLE user_alert_states/i.test(statement));
  assert.equal(alterStatements.length, 1);
  assert.match(alterStatements[0], /ON UPDATE CURRENT_TIMESTAMP\(3\)/i);
});

test("alerts forward migration is idempotent when alerts tables already exist", async () => {
  const { knex, createdTables, rawStatements } = createMigrationKnexDouble(["user_alerts", "user_alert_states"]);

  await alertsForwardMigration.up(knex);

  assert.deepEqual(createdTables, []);
  const alterStatements = rawStatements.filter((statement) => /ALTER TABLE user_alert_states/i.test(statement));
  assert.equal(alterStatements.length, 1);
});

test("alerts forward migration down is irreversible", async () => {
  await assert.rejects(
    () => alertsForwardMigration.down({}),
    /Migration 20260225000000_create_user_alerts_forward is irreversible\./
  );
});
