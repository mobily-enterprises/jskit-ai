import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementsKnexRepository } from "../src/index.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isDateLikeString(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value.trim());
}

function toComparable(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isDateLikeString(trimmed)) {
      const normalized = trimmed.includes("T") ? `${trimmed}Z` : `${trimmed.replace(" ", "T")}Z`;
      const timestamp = Date.parse(normalized);
      if (!Number.isNaN(timestamp)) {
        return timestamp;
      }
    }

    const parsedNumber = Number(trimmed);
    if (!Number.isNaN(parsedNumber) && trimmed !== "") {
      return parsedNumber;
    }

    return trimmed;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value == null) {
    return null;
  }

  return value;
}

function compareValues(left, operator, right) {
  const normalizedLeft = toComparable(left);
  const normalizedRight = toComparable(right);

  if (operator === "=") {
    return normalizedLeft === normalizedRight;
  }
  if (operator === "!=" || operator === "<>") {
    return normalizedLeft !== normalizedRight;
  }
  if (operator === ">") {
    return normalizedLeft > normalizedRight;
  }
  if (operator === ">=") {
    return normalizedLeft >= normalizedRight;
  }
  if (operator === "<") {
    return normalizedLeft < normalizedRight;
  }
  if (operator === "<=") {
    return normalizedLeft <= normalizedRight;
  }

  throw new Error(`Unsupported operator in test adapter: ${operator}`);
}

function parseWhereArgs(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === "object" && !Array.isArray(arg1)) {
    return {
      mode: "object",
      entries: Object.entries(arg1)
    };
  }

  if (arg3 !== undefined) {
    return {
      mode: "single",
      column: String(arg1),
      operator: String(arg2),
      value: arg3
    };
  }

  return {
    mode: "single",
    column: String(arg1),
    operator: "=",
    value: arg2
  };
}

function createInMemoryKnex(initialState = {}) {
  const tables = {};
  for (const [tableName, rows] of Object.entries(initialState)) {
    tables[tableName] = clone(Array.isArray(rows) ? rows : []);
  }

  if (!tables.billing_entitlement_definitions) {
    tables.billing_entitlement_definitions = [];
  }
  if (!tables.billing_entitlement_grants) {
    tables.billing_entitlement_grants = [];
  }
  if (!tables.billing_entitlement_consumptions) {
    tables.billing_entitlement_consumptions = [];
  }
  if (!tables.billing_entitlement_balances) {
    tables.billing_entitlement_balances = [];
  }

  const idCounters = new Map();
  for (const [tableName, rows] of Object.entries(tables)) {
    const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0);
    idCounters.set(tableName, maxId);
  }

  function nextId(tableName) {
    const current = Number(idCounters.get(tableName) || 0) + 1;
    idCounters.set(tableName, current);
    return current;
  }

  function createQueryBuilder(tableName, client) {
    class QueryBuilder {
      constructor() {
        this.tableName = tableName;
        this.client = client;
        this.filters = [];
        this.orderings = [];
        this.limitValue = null;
        this.firstOnly = false;
        this.insertPayload = null;
        this.updatePayload = null;
        this.deleteMode = false;
        this.aggregate = null;
        this.selectColumns = null;
        this.onConflictColumns = null;
        this.mergePayload = null;
      }

      where(arg1, arg2, arg3) {
        if (typeof arg1 === "function") {
          const predicates = [];
          const groupBuilder = {
            whereNull: (column) => {
              predicates.push((row) => row[column] == null);
              return groupBuilder;
            },
            orWhere: (column, operator, value) => {
              const parsed = parseWhereArgs(column, operator, value);
              if (parsed.mode === "single") {
                predicates.push((row) => compareValues(row[parsed.column], parsed.operator, parsed.value));
              }
              return groupBuilder;
            }
          };

          arg1(groupBuilder);
          this.filters.push((row) => predicates.length === 0 || predicates.some((predicate) => predicate(row)));
          return this;
        }

        const parsed = parseWhereArgs(arg1, arg2, arg3);
        if (parsed.mode === "object") {
          this.filters.push((row) => parsed.entries.every(([column, value]) => compareValues(row[column], "=", value)));
          return this;
        }

        this.filters.push((row) => compareValues(row[parsed.column], parsed.operator, parsed.value));
        return this;
      }

      andWhere(arg1, arg2, arg3) {
        return this.where(arg1, arg2, arg3);
      }

      whereIn(column, values) {
        const set = new Set((Array.isArray(values) ? values : []).map((entry) => toComparable(entry)));
        this.filters.push((row) => set.has(toComparable(row[column])));
        return this;
      }

      whereNotNull(column) {
        this.filters.push((row) => row[column] != null);
        return this;
      }

      whereNull(column) {
        this.filters.push((row) => row[column] == null);
        return this;
      }

      orderBy(column, direction = "asc") {
        this.orderings.push({
          column,
          direction: String(direction || "asc").toLowerCase() === "desc" ? "desc" : "asc"
        });
        return this;
      }

      limit(value) {
        this.limitValue = Math.max(0, Number(value) || 0);
        return this;
      }

      first() {
        this.firstOnly = true;
        return this;
      }

      select(columns) {
        this.selectColumns = Array.isArray(columns) ? [...columns] : [columns];
        return this;
      }

      min(payload) {
        const [[alias, column]] = Object.entries(payload || {});
        this.aggregate = {
          kind: "min",
          alias,
          column
        };
        return this;
      }

      sum(payload) {
        const [[alias, column]] = Object.entries(payload || {});
        this.aggregate = {
          kind: "sum",
          alias,
          column
        };
        return this;
      }

      count(payload) {
        const [[alias, column]] = Object.entries(payload || {});
        this.aggregate = {
          kind: "count",
          alias,
          column
        };
        return this;
      }

      insert(payload) {
        this.insertPayload = Array.isArray(payload) ? payload.map((entry) => ({ ...entry })) : { ...payload };
        return this;
      }

      update(payload) {
        this.updatePayload = { ...(payload || {}) };
        return this;
      }

      del() {
        this.deleteMode = true;
        return this;
      }

      onConflict(columns) {
        this.onConflictColumns = Array.isArray(columns) ? [...columns] : [columns];
        return {
          merge: (payload) => {
            this.mergePayload = { ...(payload || {}) };
            return this;
          }
        };
      }

      forUpdate() {
        return this;
      }

      skipLocked() {
        return this.execute();
      }

      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      }

      async execute() {
        if (!tables[this.tableName]) {
          tables[this.tableName] = [];
        }

        if (this.insertPayload != null) {
          const payloadRows = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload];
          const insertedIds = [];

          for (const payloadRow of payloadRows) {
            const row = { ...payloadRow };
            const targetRows = tables[this.tableName];

            if (this.onConflictColumns && this.mergePayload) {
              const existing = targetRows.find((entry) =>
                this.onConflictColumns.every((column) => compareValues(entry[column], "=", row[column]))
              );

              if (existing) {
                for (const [key, value] of Object.entries(this.mergePayload)) {
                  if (value && typeof value === "object" && value.__raw === "version + 1") {
                    existing[key] = Number(existing[key] || 0) + 1;
                  } else {
                    existing[key] = value;
                  }
                }
                insertedIds.push(Number(existing.id));
                continue;
              }
            }

            if (row.id == null) {
              row.id = nextId(this.tableName);
            }
            targetRows.push(row);
            insertedIds.push(Number(row.id));
          }

          return insertedIds;
        }

        const sourceRows = tables[this.tableName];
        const filtered = sourceRows.filter((row) => this.filters.every((predicate) => predicate(row)));

        if (this.deleteMode) {
          const keep = sourceRows.filter((row) => !this.filters.every((predicate) => predicate(row)));
          const affected = sourceRows.length - keep.length;
          tables[this.tableName] = keep;
          return affected;
        }

        if (this.updatePayload != null) {
          for (const row of filtered) {
            Object.assign(row, this.updatePayload);
          }
          return filtered.length;
        }

        if (this.aggregate) {
          if (this.aggregate.kind === "sum") {
            const total = filtered.reduce((sum, row) => sum + Number(row[this.aggregate.column] || 0), 0);
            const out = {
              [this.aggregate.alias]: total
            };
            return this.firstOnly ? out : [out];
          }

          if (this.aggregate.kind === "min") {
            let selected = null;
            for (const row of filtered) {
              const candidate = row[this.aggregate.column];
              if (candidate == null) {
                continue;
              }
              if (selected == null || compareValues(candidate, "<", selected)) {
                selected = candidate;
              }
            }
            const out = {
              [this.aggregate.alias]: selected
            };
            return this.firstOnly ? out : [out];
          }

          if (this.aggregate.kind === "count") {
            const total =
              this.aggregate.column === "*"
                ? filtered.length
                : filtered.reduce((sum, row) => (row[this.aggregate.column] == null ? sum : sum + 1), 0);
            const out = {
              [this.aggregate.alias]: total
            };
            return this.firstOnly ? out : [out];
          }
        }

        const sorted = [...filtered];
        for (let index = this.orderings.length - 1; index >= 0; index -= 1) {
          const ordering = this.orderings[index];
          sorted.sort((left, right) => {
            const leftValue = toComparable(left[ordering.column]);
            const rightValue = toComparable(right[ordering.column]);
            if (leftValue === rightValue) {
              return 0;
            }

            if (ordering.direction === "desc") {
              return leftValue > rightValue ? -1 : 1;
            }
            return leftValue > rightValue ? 1 : -1;
          });
        }

        let outputRows = sorted;
        if (this.limitValue != null) {
          outputRows = outputRows.slice(0, this.limitValue);
        }

        if (this.selectColumns && this.selectColumns.length > 0) {
          outputRows = outputRows.map((row) => {
            const selected = {};
            for (const column of this.selectColumns) {
              selected[column] = row[column];
            }
            return selected;
          });
        }

        const cloned = outputRows.map((row) => ({ ...row }));
        if (this.firstOnly) {
          return cloned[0];
        }
        return cloned;
      }
    }

    return new QueryBuilder();
  }

  function makeClient() {
    const client = (tableName) => createQueryBuilder(tableName, client);
    client.client = {
      config: {
        client: "mysql2"
      }
    };
    client.raw = (value) => ({ __raw: String(value || "") });
    client.schema = {
      async dropTableIfExists(tableName) {
        tables[tableName] = [];
      }
    };
    client.transaction = async (work) => {
      const trx = makeClient();
      trx.__tables = tables;
      return work(trx);
    };
    client.__tables = tables;
    return client;
  }

  return makeClient();
}

test("repository supports idempotent grant/consume and delegated recompute", async () => {
  const now = new Date("2026-02-23T12:00:00.000Z");
  const future = new Date("2026-02-24T00:00:00.000Z");

  const knex = createInMemoryKnex({
    billing_entitlement_definitions: [
      {
        id: 11,
        code: "deg2rad.calculations.monthly",
        name: "Calculations",
        description: "Monthly usage",
        entitlement_type: "metered_quota",
        unit: "calculation",
        window_interval: "month",
        window_anchor: "calendar_utc",
        aggregation_mode: "sum",
        enforcement_mode: "hard_deny",
        scope_type: "billable_entity",
        is_active: 1,
        metadata_json: "{}",
        created_at: "2026-02-01 00:00:00.000",
        updated_at: "2026-02-01 00:00:00.000"
      }
    ]
  });

  const repository = createEntitlementsKnexRepository({
    knex,
    clock: {
      now: () => now
    }
  });

  const definitions = await repository.listEntitlementDefinitions({ includeInactive: false });
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].code, "deg2rad.calculations.monthly");

  const firstGrant = await repository.insertEntitlementGrant({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    amount: 10,
    kind: "plan_base",
    sourceType: "plan_assignment",
    sourceId: 100,
    dedupeKey: "grant:7:11:initial",
    effectiveAt: now,
    now
  });
  const duplicateGrant = await repository.insertEntitlementGrant({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    amount: 10,
    kind: "plan_base",
    sourceType: "plan_assignment",
    sourceId: 100,
    dedupeKey: "grant:7:11:initial",
    effectiveAt: now,
    now
  });

  assert.equal(firstGrant.inserted, true);
  assert.equal(duplicateGrant.inserted, false);

  await repository.insertEntitlementGrant({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    amount: 30,
    kind: "plan_bonus",
    sourceType: "plan_assignment",
    sourceId: 101,
    dedupeKey: "grant:7:11:future",
    effectiveAt: future,
    now
  });

  const firstConsume = await repository.insertEntitlementConsumption({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    amount: 3,
    reasonCode: "usage",
    dedupeKey: "consumption:7:11:evt_1",
    occurredAt: now,
    now
  });
  const duplicateConsume = await repository.insertEntitlementConsumption({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    amount: 3,
    reasonCode: "usage",
    dedupeKey: "consumption:7:11:evt_1",
    occurredAt: now,
    now
  });

  assert.equal(firstConsume.inserted, true);
  assert.equal(duplicateConsume.inserted, false);

  const recomputed = await repository.recomputeEntitlementBalance({
    subjectType: "billable_entity",
    subjectId: 7,
    entitlementDefinitionId: 11,
    now
  });

  assert.equal(recomputed.definition.code, "deg2rad.calculations.monthly");
  assert.equal(recomputed.balance.grantedAmount, 10);
  assert.equal(recomputed.balance.consumedAmount, 3);
  assert.equal(recomputed.balance.effectiveAmount, 7);
  assert.equal(recomputed.balance.overLimit, false);
  assert.ok(recomputed.balance.nextChangeAt);
  assert.equal(typeof recomputed.balance.nextChangeAt, "string");

  const balances = await repository.listEntitlementBalancesForSubject({
    subjectType: "billable_entity",
    subjectId: 7
  });
  assert.equal(balances.length, 1);

  const leased = await repository.leaseDueEntitlementBalances({
    now: future,
    limit: 10,
    workerId: "worker-1"
  });
  assert.equal(leased.length, 1);
});

test("repository supports capacity recompute callbacks and table name overrides", async () => {
  const now = new Date("2026-02-23T18:00:00.000Z");
  const tableNames = {
    entitlementDefinitions: "custom_definitions",
    entitlementGrants: "custom_grants",
    entitlementConsumptions: "custom_consumptions",
    entitlementBalances: "custom_balances"
  };

  const knex = createInMemoryKnex({
    custom_definitions: [
      {
        id: 21,
        code: "projects.max",
        name: "Projects",
        description: "Project cap",
        entitlement_type: "capacity",
        unit: "project",
        window_interval: null,
        window_anchor: null,
        aggregation_mode: "sum",
        enforcement_mode: "hard_deny",
        scope_type: "billable_entity",
        is_active: 1,
        metadata_json: "{}",
        created_at: "2026-02-01 00:00:00.000",
        updated_at: "2026-02-01 00:00:00.000"
      }
    ],
    custom_grants: [
      {
        id: 1,
        subject_type: "billable_entity",
        subject_id: 8,
        entitlement_definition_id: 21,
        amount: 2,
        kind: "plan_base",
        effective_at: "2026-02-01 00:00:00.000",
        expires_at: null,
        source_type: "plan_assignment",
        source_id: 300,
        operation_key: null,
        provider: null,
        provider_event_id: null,
        dedupe_key: "grant:8:21",
        metadata_json: null,
        created_at: "2026-02-01 00:00:00.000"
      }
    ],
    custom_consumptions: [],
    custom_balances: []
  });

  const repository = createEntitlementsKnexRepository({
    knex,
    tableNames,
    resolveCapacityConsumedAmount: async ({ definition, subjectId }) => {
      assert.equal(definition.code, "projects.max");
      assert.equal(subjectId, 8);
      return 3;
    },
    resolveLockState({ definition, overLimit }) {
      if (definition.code === "projects.max" && overLimit) {
        return "projects_locked_over_cap";
      }
      return "none";
    },
    clock: {
      now: () => now
    }
  });

  const recomputed = await repository.recomputeEntitlementBalance({
    subjectType: "billable_entity",
    subjectId: 8,
    entitlementDefinitionId: 21,
    now
  });

  assert.equal(recomputed.balance.grantedAmount, 2);
  assert.equal(recomputed.balance.consumedAmount, 3);
  assert.equal(recomputed.balance.overLimit, true);
  assert.equal(recomputed.balance.lockState, "projects_locked_over_cap");

  const readBack = await repository.findEntitlementBalance({
    subjectType: "billable_entity",
    subjectId: 8,
    entitlementDefinitionId: 21
  });
  assert.ok(readBack);
  assert.equal(readBack.overLimit, true);
});
