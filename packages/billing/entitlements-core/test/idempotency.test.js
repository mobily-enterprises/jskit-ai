import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementsService } from "../src/shared/index.js";

function createRepository() {
  const definitions = [
    {
      id: 11,
      code: "deg2rad.calculations.monthly",
      entitlementType: "metered_quota",
      enforcementMode: "hard_deny",
      unit: "calculation",
      windowInterval: "month",
      windowAnchor: "calendar_utc",
      isActive: true
    }
  ];
  const grants = [];
  const consumptions = [];
  const balances = new Map();

  function toIso(value) {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  function keyForBalance(payload) {
    return [
      payload.subjectType || "billable_entity",
      Number(payload.subjectId),
      Number(payload.entitlementDefinitionId),
      toIso(payload.windowStartAt),
      toIso(payload.windowEndAt)
    ].join("::");
  }

  return {
    async transaction(work) {
      return work({ id: "trx-idempotency" });
    },
    async listEntitlementDefinitions({ includeInactive = true, codes = null } = {}) {
      return definitions.filter((entry) => {
        if (!includeInactive && entry.isActive === false) {
          return false;
        }
        if (!Array.isArray(codes) || codes.length < 1) {
          return true;
        }
        return codes.includes(entry.code);
      });
    },
    async findEntitlementDefinitionByCode(code) {
      return definitions.find((entry) => entry.code === code) || null;
    },
    async findEntitlementDefinitionById(id) {
      return definitions.find((entry) => Number(entry.id) === Number(id)) || null;
    },
    async insertEntitlementGrant(payload) {
      const dedupeKey = String(payload.dedupeKey || "").trim();
      const existing = grants.find((entry) => entry.dedupeKey === dedupeKey);
      if (existing) {
        return {
          inserted: false,
          grant: {
            ...existing,
            effectiveAt: toIso(existing.effectiveAt),
            expiresAt: existing.expiresAt ? toIso(existing.expiresAt) : null,
            createdAt: toIso(existing.createdAt)
          }
        };
      }

      const row = {
        id: grants.length + 1,
        ...payload,
        createdAt: payload.createdAt || new Date()
      };
      grants.push(row);
      return {
        inserted: true,
        grant: {
          ...row,
          effectiveAt: toIso(row.effectiveAt),
          expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
          createdAt: toIso(row.createdAt)
        }
      };
    },
    async insertEntitlementConsumption(payload) {
      const dedupeKey = String(payload.dedupeKey || "").trim();
      const existing = consumptions.find((entry) => entry.dedupeKey === dedupeKey);
      if (existing) {
        return {
          inserted: false,
          consumption: {
            ...existing,
            occurredAt: toIso(existing.occurredAt),
            createdAt: toIso(existing.createdAt)
          }
        };
      }

      const row = {
        id: consumptions.length + 1,
        ...payload,
        createdAt: payload.createdAt || new Date()
      };
      consumptions.push(row);
      return {
        inserted: true,
        consumption: {
          ...row,
          occurredAt: toIso(row.occurredAt),
          createdAt: toIso(row.createdAt)
        }
      };
    },
    async findEntitlementBalance({ subjectType = "billable_entity", subjectId, entitlementDefinitionId }) {
      const rows = [...balances.values()].filter(
        (entry) =>
          String(entry.subjectType) === String(subjectType) &&
          Number(entry.subjectId) === Number(subjectId) &&
          Number(entry.entitlementDefinitionId) === Number(entitlementDefinitionId)
      );

      rows.sort((left, right) => new Date(right.windowEndAt).getTime() - new Date(left.windowEndAt).getTime());
      return rows[0] || null;
    },
    async upsertEntitlementBalance(payload) {
      const key = keyForBalance(payload);
      const existing = balances.get(key);
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
        version: Number(existing?.version || 0) + 1,
        createdAt: existing?.createdAt || toIso(new Date()),
        updatedAt: toIso(new Date())
      };
      balances.set(key, row);
      return row;
    },
    async listEntitlementBalancesForSubject({ subjectType = "billable_entity", subjectId }) {
      return [...balances.values()].filter(
        (entry) => String(entry.subjectType) === String(subjectType) && Number(entry.subjectId) === Number(subjectId)
      );
    },
    async listNextGrantBoundariesForSubjectDefinition({ now }) {
      const normalizedNow = new Date(now || new Date());
      return grants
        .flatMap((entry) => {
          const out = [];
          const effectiveAt = new Date(entry.effectiveAt);
          if (effectiveAt.getTime() > normalizedNow.getTime()) {
            out.push(effectiveAt.toISOString());
          }
          if (entry.expiresAt) {
            const expiresAt = new Date(entry.expiresAt);
            if (expiresAt.getTime() > normalizedNow.getTime()) {
              out.push(expiresAt.toISOString());
            }
          }
          return out;
        })
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    },
    async sumEntitlementGrantAmount({ subjectType = "billable_entity", subjectId, entitlementDefinitionId, now }) {
      const normalizedNow = new Date(now || new Date());
      return grants
        .filter((entry) => {
          if (String(entry.subjectType || "billable_entity") !== String(subjectType)) {
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
    async sumEntitlementConsumptionAmount({
      subjectType = "billable_entity",
      subjectId,
      entitlementDefinitionId,
      windowStartAt,
      windowEndAt
    }) {
      const start = new Date(windowStartAt);
      const end = new Date(windowEndAt);
      return consumptions
        .filter((entry) => {
          if (String(entry.subjectType || "billable_entity") !== String(subjectType)) {
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

test("grant is idempotent by dedupe key", async () => {
  const service = createEntitlementsService({ repository: createRepository() });
  const now = new Date("2026-02-23T10:00:00.000Z");

  const first = await service.grant({
    subjectId: 44,
    entitlementDefinitionId: 11,
    amount: 5,
    kind: "topup",
    sourceType: "billing_purchase",
    sourceId: 301,
    dedupeKey: "purchase:301:definition:11",
    now
  });

  const second = await service.grant({
    subjectId: 44,
    entitlementDefinitionId: 11,
    amount: 5,
    kind: "topup",
    sourceType: "billing_purchase",
    sourceId: 301,
    dedupeKey: "purchase:301:definition:11",
    now
  });

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(first.balance.grantedAmount, 5);
  assert.equal(second.balance.grantedAmount, 5);
});

test("consume is idempotent when usageEventKey repeats", async () => {
  const service = createEntitlementsService({ repository: createRepository() });
  const now = new Date("2026-02-23T12:00:00.000Z");

  await service.grant({
    subjectId: 91,
    entitlementDefinitionId: 11,
    amount: 12,
    kind: "plan_base",
    sourceType: "plan_assignment",
    sourceId: 99,
    dedupeKey: "grant:91:11:initial",
    now
  });

  const first = await service.consume({
    subjectId: 91,
    limitationCode: "deg2rad.calculations.monthly",
    amount: 2,
    usageEventKey: "usage_evt_1",
    reasonCode: "deg2rad.calculate",
    now
  });

  const second = await service.consume({
    subjectId: 91,
    limitationCode: "deg2rad.calculations.monthly",
    amount: 2,
    usageEventKey: "usage_evt_1",
    reasonCode: "deg2rad.calculate",
    now
  });

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(first.dedupeKey, "usage:91:11:usage_evt_1");
  assert.equal(second.dedupeKey, "usage:91:11:usage_evt_1");
  assert.equal(first.balance.consumedAmount, 2);
  assert.equal(second.balance.consumedAmount, 2);
  assert.equal(second.balance.effectiveAmount, 10);
});
