import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementsService, EntitlementNotConfiguredError } from "../src/lib/index.js";

function createComputedRepository() {
  const definitions = [
    {
      id: 51,
      code: "api.calls.monthly",
      entitlementType: "metered_quota",
      enforcementMode: "hard_deny",
      unit: "call",
      windowInterval: "month",
      windowAnchor: "calendar_utc",
      isActive: true
    }
  ];

  const grants = [
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 20,
      effectiveAt: "2026-02-01T00:00:00.000Z",
      expiresAt: null
    },
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 30,
      effectiveAt: "2026-03-01T00:00:00.000Z",
      expiresAt: null
    },
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 5,
      effectiveAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-15T00:00:00.000Z"
    }
  ];

  const consumptions = [
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 3,
      occurredAt: "2026-02-10T00:00:00.000Z"
    },
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 4,
      occurredAt: "2026-02-20T00:00:00.000Z"
    },
    {
      subjectType: "billable_entity",
      subjectId: 9,
      entitlementDefinitionId: 51,
      amount: 12,
      occurredAt: "2026-01-05T00:00:00.000Z"
    }
  ];

  const balances = new Map();

  function toIso(value) {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function key(payload) {
    return [
      String(payload.subjectType || "billable_entity"),
      Number(payload.subjectId),
      Number(payload.entitlementDefinitionId),
      toIso(payload.windowStartAt),
      toIso(payload.windowEndAt)
    ].join("::");
  }

  return {
    async transaction(work) {
      return work({ id: "trx-computed" });
    },
    async listEntitlementDefinitions({ includeInactive = true, codes = null } = {}) {
      return definitions.filter((definition) => {
        if (!includeInactive && definition.isActive === false) {
          return false;
        }
        if (!Array.isArray(codes) || codes.length < 1) {
          return true;
        }
        return codes.includes(definition.code);
      });
    },
    async findEntitlementDefinitionByCode(code) {
      return definitions.find((definition) => definition.code === code) || null;
    },
    async findEntitlementDefinitionById(id) {
      return definitions.find((definition) => Number(definition.id) === Number(id)) || null;
    },
    async insertEntitlementGrant() {
      throw new Error("not needed in recompute test");
    },
    async insertEntitlementConsumption() {
      throw new Error("not needed in recompute test");
    },
    async findEntitlementBalance(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const entitlementDefinitionId = Number(payload.entitlementDefinitionId);
      const rows = [...balances.values()].filter(
        (entry) =>
          String(entry.subjectType || "billable_entity") === subjectType &&
          Number(entry.subjectId) === subjectId &&
          Number(entry.entitlementDefinitionId) === entitlementDefinitionId
      );
      rows.sort((left, right) => new Date(right.windowEndAt).getTime() - new Date(left.windowEndAt).getTime());
      return rows[0] || null;
    },
    async upsertEntitlementBalance(payload = {}) {
      const balanceKey = key(payload);
      const existing = balances.get(balanceKey);
      const row = {
        id: existing?.id || balances.size + 1,
        subjectType: String(payload.subjectType || "billable_entity"),
        subjectId: Number(payload.subjectId),
        entitlementDefinitionId: Number(payload.entitlementDefinitionId),
        windowStartAt: toIso(payload.windowStartAt),
        windowEndAt: toIso(payload.windowEndAt),
        grantedAmount: Number(payload.grantedAmount || 0),
        consumedAmount: Number(payload.consumedAmount || 0),
        effectiveAmount: Number(payload.effectiveAmount || 0),
        hardLimitAmount: payload.hardLimitAmount == null ? null : Number(payload.hardLimitAmount),
        overLimit: Boolean(payload.overLimit),
        lockState: payload.lockState == null ? null : String(payload.lockState),
        nextChangeAt: payload.nextChangeAt ? toIso(payload.nextChangeAt) : null,
        lastRecomputedAt: toIso(payload.lastRecomputedAt || new Date()),
        metadataJson: payload.metadataJson || {},
        createdAt: existing?.createdAt || toIso(new Date()),
        updatedAt: toIso(new Date()),
        version: Number(existing?.version || 0) + 1
      };
      balances.set(balanceKey, row);
      return row;
    },
    async listEntitlementBalancesForSubject() {
      return [...balances.values()];
    },
    async listNextGrantBoundariesForSubjectDefinition({ subjectType, subjectId, entitlementDefinitionId, now }) {
      const normalizedNow = new Date(now || new Date());
      return grants
        .filter((entry) => {
          if (String(entry.subjectType || "billable_entity") !== String(subjectType || "billable_entity")) {
            return false;
          }
          if (Number(entry.subjectId) !== Number(subjectId)) {
            return false;
          }
          if (Number(entry.entitlementDefinitionId) !== Number(entitlementDefinitionId)) {
            return false;
          }

          const effectiveAt = new Date(entry.effectiveAt);
          const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
          return effectiveAt.getTime() > normalizedNow.getTime() || (expiresAt && expiresAt.getTime() > normalizedNow.getTime());
        })
        .flatMap((entry) => {
          const values = [];
          const effectiveAt = new Date(entry.effectiveAt);
          if (effectiveAt.getTime() > normalizedNow.getTime()) {
            values.push(effectiveAt.toISOString());
          }
          if (entry.expiresAt) {
            const expiresAt = new Date(entry.expiresAt);
            if (expiresAt.getTime() > normalizedNow.getTime()) {
              values.push(expiresAt.toISOString());
            }
          }
          return values;
        })
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    },
    async sumEntitlementGrantAmount({ subjectType, subjectId, entitlementDefinitionId, now }) {
      const normalizedNow = new Date(now || new Date());
      return grants
        .filter((entry) => {
          if (String(entry.subjectType || "billable_entity") !== String(subjectType || "billable_entity")) {
            return false;
          }
          if (Number(entry.subjectId) !== Number(subjectId)) {
            return false;
          }
          if (Number(entry.entitlementDefinitionId) !== Number(entitlementDefinitionId)) {
            return false;
          }
          const effectiveAt = new Date(entry.effectiveAt);
          if (effectiveAt.getTime() > normalizedNow.getTime()) {
            return false;
          }
          if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= normalizedNow.getTime()) {
            return false;
          }
          return true;
        })
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    },
    async sumEntitlementConsumptionAmount({ subjectType, subjectId, entitlementDefinitionId, windowStartAt, windowEndAt }) {
      const start = new Date(windowStartAt);
      const end = new Date(windowEndAt);
      return consumptions
        .filter((entry) => {
          if (String(entry.subjectType || "billable_entity") !== String(subjectType || "billable_entity")) {
            return false;
          }
          if (Number(entry.subjectId) !== Number(subjectId)) {
            return false;
          }
          if (Number(entry.entitlementDefinitionId) !== Number(entitlementDefinitionId)) {
            return false;
          }
          const occurredAt = new Date(entry.occurredAt);
          return occurredAt.getTime() >= start.getTime() && occurredAt.getTime() < end.getTime();
        })
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    }
  };
}

function createDelegatedRepository() {
  const definition = {
    id: 99,
    code: "delegated.definition",
    entitlementType: "balance",
    enforcementMode: "hard_deny",
    unit: "credit",
    windowInterval: null,
    windowAnchor: null,
    isActive: true
  };

  return {
    async listEntitlementDefinitions() {
      return [definition];
    },
    async findEntitlementDefinitionByCode(code) {
      return code === definition.code ? definition : null;
    },
    async findEntitlementDefinitionById(id) {
      return Number(id) === Number(definition.id) ? definition : null;
    },
    async insertEntitlementGrant() {
      return {
        inserted: true,
        grant: null
      };
    },
    async insertEntitlementConsumption() {
      return {
        inserted: true,
        consumption: null
      };
    },
    async findEntitlementBalance() {
      return null;
    },
    async upsertEntitlementBalance() {
      return null;
    },
    async listEntitlementBalancesForSubject() {
      return [];
    },
    async listNextGrantBoundariesForSubjectDefinition() {
      return [];
    },
    async recomputeEntitlementBalance(payload) {
      return {
        definition,
        balance: {
          subjectType: payload.subjectType,
          subjectId: Number(payload.subjectId),
          entitlementDefinitionId: definition.id,
          windowStartAt: "1970-01-01T00:00:00.000Z",
          windowEndAt: "9999-12-31T23:59:59.999Z",
          grantedAmount: 50,
          consumedAmount: 20,
          effectiveAmount: 30,
          hardLimitAmount: null,
          overLimit: false,
          lockState: "none",
          nextChangeAt: null,
          lastRecomputedAt: new Date(payload.now || new Date()).toISOString()
        }
      };
    }
  };
}

test("recompute is deterministic and window-safe with computed aggregation methods", async () => {
  const service = createEntitlementsService({ repository: createComputedRepository() });
  const now = new Date("2026-02-23T12:00:00.000Z");

  const first = await service.recompute({
    subjectId: 9,
    limitationCode: "api.calls.monthly",
    now
  });
  const second = await service.recompute({
    subjectId: 9,
    limitationCode: "api.calls.monthly",
    now
  });

  assert.deepEqual(first, second);
  assert.equal(first.balance.grantedAmount, 20);
  assert.equal(first.balance.consumedAmount, 7);
  assert.equal(first.balance.effectiveAmount, 13);
  assert.equal(first.balance.overLimit, false);

  await assert.rejects(
    () =>
      service.recompute({
        subjectId: 9,
        limitationCode: "api.calls.monthly",
        windowStartAt: "2026-03-01T00:00:00.000Z",
        windowEndAt: "2026-02-01T00:00:00.000Z",
        now
      }),
    /windowEndAt/
  );
});

test("recompute falls back to delegated repository recompute when aggregate methods are unavailable", async () => {
  const service = createEntitlementsService({ repository: createDelegatedRepository() });

  const recomputed = await service.recompute({
    subjectId: 77,
    limitationCode: "delegated.definition",
    now: new Date("2026-02-23T12:30:00.000Z")
  });

  assert.equal(recomputed.definition.code, "delegated.definition");
  assert.equal(recomputed.balance.effectiveAmount, 30);

  await assert.rejects(
    () =>
      service.recompute({
        subjectId: 77,
        limitationCode: "missing.definition",
        now: new Date("2026-02-23T12:30:00.000Z")
      }),
    (error) => error instanceof EntitlementNotConfiguredError
  );
});
