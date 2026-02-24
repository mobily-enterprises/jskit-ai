import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const baselineMigration = require("../migrations/20260224000000_baseline_schema.cjs");
const { BASELINE_STEP_FILES, createBaselineRunner } = baselineMigration.__testables;

test("baseline migration contains the full historical step sequence in order", () => {
  assert.equal(BASELINE_STEP_FILES[0], "20260215120000_create_user_profiles.cjs");
  assert.equal(BASELINE_STEP_FILES[BASELINE_STEP_FILES.length - 1], "20260223150000_remove_workspace_default_calculation_policy.cjs");
  assert.ok(BASELINE_STEP_FILES.includes("20260219120000_create_workspace_projects.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260223100000_add_deg2rad_columns_to_calculation_logs.cjs"));
  assert.ok(BASELINE_STEP_FILES.includes("20260223090000_enforce_unique_workspace_room_thread.cjs"));
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
