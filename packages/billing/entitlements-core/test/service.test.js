import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementsService } from "../src/lib/index.js";

function createInMemoryRepository({ definitions = [] } = {}) {
  const grants = [];
  const consumptions = [];
  const balances = new Map();

  const definitionRows =
    definitions.length > 0
      ? definitions.map((definition) => ({ ...definition }))
      : [
          {
            id: 1,
            code: "api.calls.monthly",
            entitlementType: "metered_quota",
            enforcementMode: "hard_deny",
            unit: "call",
            windowInterval: "month",
            windowAnchor: "calendar_utc",
            isActive: true
          },
          {
            id: 2,
            code: "projects.max",
            entitlementType: "capacity",
            enforcementMode: "hard_lock_resource",
            unit: "project",
            windowInterval: null,
            windowAnchor: null,
            isActive: true
          }
        ];

  function toIso(value) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  function buildBalanceKey(payload) {
    return [
      String(payload.subjectType || "billable_entity"),
      Number(payload.subjectId),
      Number(payload.entitlementDefinitionId),
      toIso(payload.windowStartAt),
      toIso(payload.windowEndAt)
    ].join("::");
  }

  function mapGrant(row) {
    return {
      ...row,
      effectiveAt: toIso(row.effectiveAt),
      expiresAt: row.expiresAt ? toIso(row.expiresAt) : null,
      createdAt: toIso(row.createdAt)
    };
  }

  function mapConsumption(row) {
    return {
      ...row,
      occurredAt: toIso(row.occurredAt),
      createdAt: toIso(row.createdAt)
    };
  }

  return {
    async transaction(work) {
      return work({ id: "trx_1" });
    },
    async listEntitlementDefinitions({ includeInactive = true, codes = null } = {}) {
      return definitionRows.filter((definition) => {
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
      return definitionRows.find((definition) => String(definition.code) === String(code)) || null;
    },
    async findEntitlementDefinitionById(id) {
      return definitionRows.find((definition) => Number(definition.id) === Number(id)) || null;
    },
    async insertEntitlementGrant(payload = {}) {
      const dedupeKey = String(payload.dedupeKey || "").trim();
      const existing = grants.find((entry) => entry.dedupeKey === dedupeKey);
      if (existing) {
        return {
          inserted: false,
          grant: mapGrant(existing)
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
        grant: mapGrant(row)
      };
    },
    async insertEntitlementConsumption(payload = {}) {
      const dedupeKey = String(payload.dedupeKey || "").trim();
      const existing = consumptions.find((entry) => entry.dedupeKey === dedupeKey);
      if (existing) {
        return {
          inserted: false,
          consumption: mapConsumption(existing)
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
        consumption: mapConsumption(row)
      };
    },
    async findEntitlementBalance(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const entitlementDefinitionId = Number(payload.entitlementDefinitionId);
      const explicitWindow = payload.windowStartAt && payload.windowEndAt;

      let matches = [...balances.values()].filter(
        (row) =>
          String(row.subjectType || "billable_entity") === subjectType &&
          Number(row.subjectId) === subjectId &&
          Number(row.entitlementDefinitionId) === entitlementDefinitionId
      );

      if (explicitWindow) {
        const windowStart = toIso(payload.windowStartAt);
        const windowEnd = toIso(payload.windowEndAt);
        matches = matches.filter((row) => row.windowStartAt === windowStart && row.windowEndAt === windowEnd);
      }

      matches.sort((left, right) => new Date(right.windowEndAt).getTime() - new Date(left.windowEndAt).getTime());
      return matches[0] || null;
    },
    async upsertEntitlementBalance(payload = {}) {
      const key = buildBalanceKey(payload);
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
    async listEntitlementBalancesForSubject(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const allowedDefinitionIds = Array.isArray(payload.entitlementDefinitionIds)
        ? payload.entitlementDefinitionIds.map((entry) => Number(entry))
        : null;

      return [...balances.values()]
        .filter((row) => {
          if (String(row.subjectType || "billable_entity") !== subjectType) {
            return false;
          }
          if (Number(row.subjectId) !== subjectId) {
            return false;
          }
          if (!allowedDefinitionIds || allowedDefinitionIds.length < 1) {
            return true;
          }
          return allowedDefinitionIds.includes(Number(row.entitlementDefinitionId));
        })
        .sort((left, right) => {
          if (Number(left.entitlementDefinitionId) !== Number(right.entitlementDefinitionId)) {
            return Number(left.entitlementDefinitionId) - Number(right.entitlementDefinitionId);
          }
          return new Date(right.windowEndAt).getTime() - new Date(left.windowEndAt).getTime();
        });
    },
    async listNextGrantBoundariesForSubjectDefinition(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const entitlementDefinitionId = Number(payload.entitlementDefinitionId);
      const now = new Date(payload.now || new Date());

      return grants
        .filter((row) => {
          if (String(row.subjectType || "billable_entity") !== subjectType) {
            return false;
          }
          if (Number(row.subjectId) !== subjectId) {
            return false;
          }
          if (Number(row.entitlementDefinitionId) !== entitlementDefinitionId) {
            return false;
          }

          const effectiveAt = new Date(row.effectiveAt);
          const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
          return effectiveAt.getTime() > now.getTime() || (expiresAt && expiresAt.getTime() > now.getTime());
        })
        .flatMap((row) => {
          const candidates = [];
          const effectiveAt = new Date(row.effectiveAt);
          if (effectiveAt.getTime() > now.getTime()) {
            candidates.push(effectiveAt.toISOString());
          }
          if (row.expiresAt) {
            const expiresAt = new Date(row.expiresAt);
            if (expiresAt.getTime() > now.getTime()) {
              candidates.push(expiresAt.toISOString());
            }
          }
          return candidates;
        })
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
    },
    async sumEntitlementGrantAmount(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const entitlementDefinitionId = Number(payload.entitlementDefinitionId);
      const now = new Date(payload.now || new Date());

      return grants
        .filter((row) => {
          if (String(row.subjectType || "billable_entity") !== subjectType) {
            return false;
          }
          if (Number(row.subjectId) !== subjectId) {
            return false;
          }
          if (Number(row.entitlementDefinitionId) !== entitlementDefinitionId) {
            return false;
          }

          const effectiveAt = new Date(row.effectiveAt);
          const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
          if (effectiveAt.getTime() > now.getTime()) {
            return false;
          }
          if (expiresAt && expiresAt.getTime() <= now.getTime()) {
            return false;
          }
          return true;
        })
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    },
    async sumEntitlementConsumptionAmount(payload = {}) {
      const subjectType = String(payload.subjectType || "billable_entity");
      const subjectId = Number(payload.subjectId);
      const entitlementDefinitionId = Number(payload.entitlementDefinitionId);
      const windowStartAt = new Date(payload.windowStartAt);
      const windowEndAt = new Date(payload.windowEndAt);

      return consumptions
        .filter((row) => {
          if (String(row.subjectType || "billable_entity") !== subjectType) {
            return false;
          }
          if (Number(row.subjectId) !== subjectId) {
            return false;
          }
          if (Number(row.entitlementDefinitionId) !== entitlementDefinitionId) {
            return false;
          }

          const occurredAt = new Date(row.occurredAt);
          return occurredAt.getTime() >= windowStartAt.getTime() && occurredAt.getTime() < windowEndAt.getTime();
        })
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    }
  };
}

test("resolveEffectiveLimitations is deterministic for the same subject state", async () => {
  const repository = createInMemoryRepository();
  const service = createEntitlementsService(
    {
      repository
    },
    {
      policy: {
        resolveLockState({ definition, overLimit }) {
          if (definition?.code === "projects.max" && overLimit) {
            return "projects_locked_over_cap";
          }
          return "none";
        }
      }
    }
  );

  const now = new Date("2026-02-23T15:00:00.000Z");

  await service.grant({
    subjectId: 7,
    entitlementDefinitionId: 1,
    amount: 10,
    kind: "plan_base",
    sourceType: "plan_assignment",
    sourceId: 100,
    dedupeKey: "grant:api.monthly:1",
    now
  });

  await service.grant({
    subjectId: 7,
    entitlementDefinitionId: 2,
    amount: 3,
    kind: "plan_base",
    sourceType: "plan_assignment",
    sourceId: 100,
    dedupeKey: "grant:projects.max:1",
    now
  });

  await service.consume({
    subjectId: 7,
    limitationCode: "api.calls.monthly",
    amount: 2,
    usageEventKey: "usage-event-1",
    reasonCode: "deg2rad.calculate",
    now
  });

  const subject = {
    subjectType: "billable_entity",
    subjectId: 7,
    limitationCodes: ["projects.max", "api.calls.monthly"],
    now,
    capacityResolvers: {
      "projects.max": async () => 1
    }
  };

  const first = await service.resolveEffectiveLimitations(subject);
  const second = await service.resolveEffectiveLimitations(subject);

  function stripPreviousRows(payload) {
    return {
      ...payload,
      limitations: payload.limitations.map(({ _previous, ...limitation }) => limitation)
    };
  }

  assert.deepEqual(stripPreviousRows(first), stripPreviousRows(second));
  assert.equal(first.limitations.length, 2);

  const apiMonthly = first.limitations.find((entry) => entry.code === "api.calls.monthly");
  assert.equal(apiMonthly.grantedAmount, 10);
  assert.equal(apiMonthly.consumedAmount, 2);
  assert.equal(apiMonthly.effectiveAmount, 8);

  const projectCap = first.limitations.find((entry) => entry.code === "projects.max");
  assert.equal(projectCap.grantedAmount, 3);
  assert.equal(projectCap.consumedAmount, 1);
  assert.equal(projectCap.overLimit, false);
});

test("grant and consume reject invalid input", async () => {
  const repository = createInMemoryRepository();
  const service = createEntitlementsService({ repository });

  await assert.rejects(
    () =>
      service.grant({
        subjectId: 1,
        entitlementDefinitionId: 1,
        amount: 0,
        dedupeKey: "grant:bad"
      }),
    /non-zero integer/
  );

  await assert.rejects(
    () =>
      service.grant({
        subjectId: 1,
        entitlementDefinitionId: 1,
        amount: 2,
        dedupeKey: "grant:bad-window",
        effectiveAt: "2026-02-23T10:00:00.000Z",
        expiresAt: "2026-02-23T09:00:00.000Z"
      }),
    /expiresAt/
  );

  await assert.rejects(
    () =>
      service.consume({
        subjectId: 1,
        limitationCode: "api.calls.monthly",
        amount: 0,
        usageEventKey: "usage-1"
      }),
    /positive integer/
  );
});
