import {
  DEFAULT_SUBJECT_TYPE,
  ENTITLEMENT_TYPES,
  normalizeAmount,
  normalizeBalanceRow,
  normalizeCodes,
  normalizeSubjectType,
  toDateOrNull,
  toNonEmptyString,
  toPositiveInteger
} from "./entities.js";
import { createEntitlementsPolicy } from "./policies.js";
import { assertEntitlementsRepository, validateEntitlementsRepository } from "./contracts/repository.js";
import { resolveClock } from "./contracts/clock.js";
import { resolveLogger } from "./contracts/logger.js";
import {
  EntitlementsError,
  EntitlementNotConfiguredError,
  EntitlementsValidationError,
  ENTITLEMENTS_ERROR_CODES
} from "./errors.js";

const MATERIAL_BALANCE_KEYS = [
  "grantedAmount",
  "consumedAmount",
  "effectiveAmount",
  "hardLimitAmount",
  "overLimit",
  "lockState",
  "nextChangeAt"
];

function hasMaterialBalanceChange(previousBalance, nextBalance) {
  if (!previousBalance && nextBalance) {
    return true;
  }
  if (previousBalance && !nextBalance) {
    return true;
  }
  if (!previousBalance && !nextBalance) {
    return false;
  }

  return MATERIAL_BALANCE_KEYS.some((key) => {
    const left = previousBalance?.[key] == null ? null : previousBalance[key];
    const right = nextBalance?.[key] == null ? null : nextBalance[key];
    return String(left) !== String(right);
  });
}

function toOptionsWithTransaction(trx) {
  if (trx && typeof trx === "object") {
    return { trx };
  }
  return {};
}

function toAggregateNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (!value || typeof value !== "object") {
    return 0;
  }

  const candidate =
    value.total ?? value.amount ?? value.sum ?? value.sumAmount ?? value.grantedAmount ?? value.consumedAmount ?? 0;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runInTransaction(repository, explicitTrx, callback) {
  if (explicitTrx && typeof explicitTrx === "object") {
    return callback(explicitTrx);
  }
  if (typeof repository.transaction === "function") {
    return repository.transaction((trx) => callback(trx));
  }
  return callback(null);
}

function normalizeNow(nowInput, clock) {
  return toDateOrNull(nowInput) || toDateOrNull(clock.now()) || new Date();
}

function assertWindowRange(windowStartAt, windowEndAt) {
  if (!windowStartAt || !windowEndAt) {
    return;
  }

  if (windowEndAt.getTime() <= windowStartAt.getTime()) {
    throw new EntitlementsValidationError("windowEndAt must be later than windowStartAt.", {
      details: {
        windowStartAt: windowStartAt.toISOString(),
        windowEndAt: windowEndAt.toISOString()
      }
    });
  }
}

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    return null;
  }

  return {
    id: toPositiveInteger(definition.id),
    code: toNonEmptyString(definition.code),
    entitlementType: toNonEmptyString(definition.entitlementType).toLowerCase(),
    enforcementMode: toNonEmptyString(definition.enforcementMode) || "hard_deny",
    unit: toNonEmptyString(definition.unit),
    windowInterval: toNonEmptyString(definition.windowInterval) || null,
    windowAnchor: toNonEmptyString(definition.windowAnchor) || null,
    isActive: definition.isActive !== false,
    metadataJson: definition.metadataJson && typeof definition.metadataJson === "object" ? definition.metadataJson : {}
  };
}

function resolveDefinitionIdentifier(input = {}) {
  const definitionId = toPositiveInteger(input.entitlementDefinitionId ?? input.entitlement_definition_id);
  const definitionCode = toNonEmptyString(input.limitationCode || input.entitlementCode || input.code).trim();

  return {
    definitionId,
    definitionCode
  };
}

function createContractViolation(message, details = {}) {
  return new EntitlementsError(message, {
    code: ENTITLEMENTS_ERROR_CODES.CONTRACT_VIOLATION,
    statusCode: 500,
    details
  });
}

function normalizeNextBoundaries(boundaries = []) {
  if (!Array.isArray(boundaries)) {
    return [];
  }

  return boundaries
    .map((entry) => toDateOrNull(entry))
    .filter(Boolean)
    .map((entry) => entry.toISOString())
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
}

export function createEntitlementsService(deps = {}, options = {}) {
  const repository = assertEntitlementsRepository(deps.repository, {
    name: "repository"
  });
  const clock = resolveClock(deps.clock);
  const logger = resolveLogger(deps.logger);
  const policy = createEntitlementsPolicy(options.policy);

  const repositoryValidation = validateEntitlementsRepository(repository);

  async function resolveDefinition({ definitionId, definitionCode, trx }) {
    const queryOptions = toOptionsWithTransaction(trx);
    if (definitionId) {
      const byId = await repository.findEntitlementDefinitionById(definitionId, queryOptions);
      return normalizeDefinition(byId);
    }
    if (definitionCode) {
      const byCode = await repository.findEntitlementDefinitionByCode(definitionCode, queryOptions);
      return normalizeDefinition(byCode);
    }
    return null;
  }

  async function recomputeWithAggregations(input = {}) {
    const normalizedSubjectType = normalizeSubjectType(input.subjectType || input.subject_type || DEFAULT_SUBJECT_TYPE);
    const normalizedSubjectId = toPositiveInteger(input.subjectId ?? input.subject_id ?? input.billableEntityId);
    if (!normalizedSubjectId) {
      throw new EntitlementsValidationError("subjectId must be a positive integer.");
    }

    const { definitionId, definitionCode } = resolveDefinitionIdentifier(input);
    if (!definitionId && !definitionCode) {
      throw new EntitlementsValidationError("recompute requires entitlementDefinitionId or limitationCode.");
    }

    const normalizedNow = normalizeNow(input.now, clock);
    const definition = await resolveDefinition({
      definitionId,
      definitionCode,
      trx: input.trx || null
    });
    if (!definition) {
      throw new EntitlementNotConfiguredError("Entitlement definition is not configured.", {
        details: {
          entitlementDefinitionId: definitionId || null,
          limitationCode: definitionCode || null
        }
      });
    }

    const explicitWindowStart = toDateOrNull(input.windowStartAt ?? input.window_start_at);
    const explicitWindowEnd = toDateOrNull(input.windowEndAt ?? input.window_end_at);
    assertWindowRange(explicitWindowStart, explicitWindowEnd);

    const resolvedWindow =
      explicitWindowStart && explicitWindowEnd
        ? {
            windowStartAt: explicitWindowStart,
            windowEndAt: explicitWindowEnd
          }
        : policy.resolveCalendarWindow(definition.windowInterval, normalizedNow, {
            definition,
            subjectType: normalizedSubjectType,
            subjectId: normalizedSubjectId
          });

    assertWindowRange(resolvedWindow?.windowStartAt, resolvedWindow?.windowEndAt);

    const queryOptions = toOptionsWithTransaction(input.trx || null);
    const grantedAmount = toAggregateNumber(
      await repository.sumEntitlementGrantAmount(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: definition.id,
          now: normalizedNow
        },
        queryOptions
      )
    );

    let consumedAmount = 0;
    const explicitCapacityConsumedAmount = Number(input.capacityConsumedAmount);
    const inlineCapacityResolver =
      typeof input.capacityConsumedAmountResolver === "function" ? input.capacityConsumedAmountResolver : null;

    if (definition.entitlementType === ENTITLEMENT_TYPES.CAPACITY) {
      if (inlineCapacityResolver) {
        consumedAmount = Number(
          await inlineCapacityResolver({
            definition,
            subjectType: normalizedSubjectType,
            subjectId: normalizedSubjectId,
            now: normalizedNow,
            trx: input.trx || null
          })
        );
      } else if (Number.isFinite(explicitCapacityConsumedAmount)) {
        consumedAmount = explicitCapacityConsumedAmount;
      } else if (typeof policy.resolveCapacityConsumedAmount === "function") {
        consumedAmount = Number(
          await policy.resolveCapacityConsumedAmount({
            definition,
            subjectType: normalizedSubjectType,
            subjectId: normalizedSubjectId,
            now: normalizedNow,
            trx: input.trx || null
          })
        );
      }
    } else {
      consumedAmount = toAggregateNumber(
        await repository.sumEntitlementConsumptionAmount(
          {
            subjectType: normalizedSubjectType,
            subjectId: normalizedSubjectId,
            entitlementDefinitionId: definition.id,
            windowStartAt: resolvedWindow.windowStartAt,
            windowEndAt: resolvedWindow.windowEndAt,
            now: normalizedNow
          },
          queryOptions
        )
      );
    }

    const safeConsumedAmount = Number.isFinite(consumedAmount) ? Math.max(0, consumedAmount) : 0;
    const effectiveAmount = grantedAmount - safeConsumedAmount;
    const hardLimitAmount = policy.resolveHardLimitAmount({
      definition,
      grantedAmount,
      consumedAmount: safeConsumedAmount,
      effectiveAmount,
      windowStartAt: resolvedWindow.windowStartAt,
      windowEndAt: resolvedWindow.windowEndAt,
      now: normalizedNow
    });

    const overLimit = Boolean(
      policy.resolveOverLimit({
        definition,
        grantedAmount,
        consumedAmount: safeConsumedAmount,
        effectiveAmount,
        windowStartAt: resolvedWindow.windowStartAt,
        windowEndAt: resolvedWindow.windowEndAt,
        now: normalizedNow
      })
    );

    const lockState =
      toNonEmptyString(
        policy.resolveLockState({
          definition,
          grantedAmount,
          consumedAmount: safeConsumedAmount,
          effectiveAmount,
          overLimit,
          hardLimitAmount,
          windowStartAt: resolvedWindow.windowStartAt,
          windowEndAt: resolvedWindow.windowEndAt,
          now: normalizedNow
        })
      ) || null;

    const boundaries = normalizeNextBoundaries(
      await repository.listNextGrantBoundariesForSubjectDefinition(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: definition.id,
          now: normalizedNow
        },
        queryOptions
      )
    );

    const persistedBalance = await repository.upsertEntitlementBalance(
      {
        subjectType: normalizedSubjectType,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: definition.id,
        windowStartAt: resolvedWindow.windowStartAt,
        windowEndAt: resolvedWindow.windowEndAt,
        grantedAmount,
        consumedAmount: safeConsumedAmount,
        effectiveAmount,
        hardLimitAmount,
        overLimit,
        lockState,
        nextChangeAt: boundaries[0] || null,
        lastRecomputedAt: normalizedNow,
        metadataJson: {
          definitionCode: definition.code,
          entitlementType: definition.entitlementType
        }
      },
      queryOptions
    );

    return {
      definition,
      balance: normalizeBalanceRow(persistedBalance)
    };
  }

  async function recomputeDelegated(input = {}) {
    if (typeof repository.recomputeEntitlementBalance !== "function") {
      throw createContractViolation("recomputeEntitlementBalance is not available on repository.");
    }

    const normalizedSubjectId = toPositiveInteger(input.subjectId ?? input.subject_id ?? input.billableEntityId);
    if (!normalizedSubjectId) {
      throw new EntitlementsValidationError("subjectId must be a positive integer.");
    }

    const { definitionId, definitionCode } = resolveDefinitionIdentifier(input);
    if (!definitionId && !definitionCode) {
      throw new EntitlementsValidationError("recompute requires entitlementDefinitionId or limitationCode.");
    }

    const definition = await resolveDefinition({
      definitionId,
      definitionCode,
      trx: input.trx || null
    });

    const delegatedPayload = {
      ...input,
      subjectType: normalizeSubjectType(input.subjectType || input.subject_type || DEFAULT_SUBJECT_TYPE),
      subjectId: normalizedSubjectId,
      entitlementDefinitionId: definition?.id || definitionId || null,
      now: normalizeNow(input.now, clock)
    };

    const delegated = await repository.recomputeEntitlementBalance(delegatedPayload, toOptionsWithTransaction(input.trx || null));
    const delegatedDefinition = normalizeDefinition(delegated?.definition);
    const resolvedDefinition =
      delegatedDefinition ||
      definition ||
      (definitionId || definitionCode
        ? {
            id: definitionId || null,
            code: definitionCode || "",
            entitlementType: "",
            enforcementMode: "hard_deny",
            unit: "",
            windowInterval: null,
            windowAnchor: null,
            isActive: true,
            metadataJson: {}
          }
        : null);

    if (!resolvedDefinition) {
      throw new EntitlementNotConfiguredError("Entitlement definition is not configured.", {
        details: {
          entitlementDefinitionId: definitionId || null,
          limitationCode: definitionCode || null
        }
      });
    }

    return {
      definition: resolvedDefinition,
      balance: normalizeBalanceRow(delegated?.balance || null)
    };
  }

  async function recompute(input = {}) {
    return runInTransaction(repository, input.trx || null, async (trx) => {
      const payload = {
        ...input,
        trx
      };

      if (repositoryValidation.supportsDelegatedRecompute) {
        return recomputeDelegated(payload);
      }

      logger.debug("entitlements-core.recompute.computed", {
        reason: "repository_missing_delegated_recompute"
      });
      return recomputeWithAggregations(payload);
    });
  }

  async function grant(input = {}) {
    const normalizedSubjectType = normalizeSubjectType(input.subjectType || input.subject_type || DEFAULT_SUBJECT_TYPE);
    const normalizedSubjectId = toPositiveInteger(input.subjectId ?? input.subject_id ?? input.billableEntityId);
    const normalizedDefinitionId = toPositiveInteger(input.entitlementDefinitionId ?? input.entitlement_definition_id);
    const amount = normalizeAmount(input.amount, { allowNegative: true, requireNonZero: true });
    const dedupeKey = toNonEmptyString(input.dedupeKey || input.dedupe_key);

    if (!normalizedSubjectId || !normalizedDefinitionId) {
      throw new EntitlementsValidationError("grant requires subjectId and entitlementDefinitionId.");
    }
    if (amount == null) {
      throw new EntitlementsValidationError("grant amount must be a non-zero integer.");
    }
    if (!dedupeKey) {
      throw new EntitlementsValidationError("grant requires dedupeKey.");
    }

    const effectiveAt = toDateOrNull(input.effectiveAt || input.effective_at) || normalizeNow(input.now, clock);
    const expiresAt = toDateOrNull(input.expiresAt || input.expires_at);
    if (expiresAt && expiresAt.getTime() <= effectiveAt.getTime()) {
      throw new EntitlementsValidationError("grant expiresAt must be later than effectiveAt.");
    }

    return runInTransaction(repository, input.trx || null, async (trx) => {
      const previousBalance = await repository.findEntitlementBalance(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: normalizedDefinitionId
        },
        toOptionsWithTransaction(trx)
      );

      const inserted = await repository.insertEntitlementGrant(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: normalizedDefinitionId,
          amount,
          kind: toNonEmptyString(input.kind) || "manual_adjustment",
          effectiveAt,
          expiresAt,
          sourceType: toNonEmptyString(input.sourceType || input.source_type) || "manual_console",
          sourceId: input.sourceId ?? input.source_id ?? null,
          operationKey: input.operationKey ?? input.operation_key ?? null,
          provider: input.provider ?? null,
          providerEventId: input.providerEventId ?? input.provider_event_id ?? null,
          dedupeKey,
          metadataJson: input.metadataJson ?? input.metadata_json ?? null,
          createdAt: input.createdAt ?? input.created_at ?? null
        },
        toOptionsWithTransaction(trx)
      );

      const recomputed = await recompute({
        subjectType: normalizedSubjectType,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: normalizedDefinitionId,
        now: input.now,
        trx,
        capacityConsumedAmount: input.capacityConsumedAmount,
        capacityConsumedAmountResolver: input.capacityConsumedAmountResolver
      });

      const nextBalance = recomputed?.balance || null;

      return {
        inserted: Boolean(inserted?.inserted),
        grant: inserted?.grant || null,
        definition: recomputed?.definition || null,
        balance: nextBalance,
        changed: hasMaterialBalanceChange(normalizeBalanceRow(previousBalance), nextBalance)
      };
    });
  }

  async function consume(input = {}) {
    const normalizedSubjectType = normalizeSubjectType(input.subjectType || input.subject_type || DEFAULT_SUBJECT_TYPE);
    const normalizedSubjectId = toPositiveInteger(input.subjectId ?? input.subject_id ?? input.billableEntityId);
    const amount = normalizeAmount(input.amount, { allowNegative: false, requireNonZero: true });

    if (!normalizedSubjectId) {
      throw new EntitlementsValidationError("consume requires subjectId.");
    }
    if (amount == null) {
      throw new EntitlementsValidationError("consume amount must be a positive integer.");
    }

    return runInTransaction(repository, input.trx || null, async (trx) => {
      const { definitionId, definitionCode } = resolveDefinitionIdentifier(input);
      const definition = await resolveDefinition({
        definitionId,
        definitionCode,
        trx
      });

      if (!definition) {
        throw new EntitlementNotConfiguredError("Entitlement definition is not configured.", {
          details: {
            entitlementDefinitionId: definitionId || null,
            limitationCode: definitionCode || null
          }
        });
      }

      const reasonCode = toNonEmptyString(input.reasonCode || input.reason_code).toLowerCase() || "usage";
      const dedupeKey = policy.buildConsumptionDedupeKey({
        dedupeKey: input.dedupeKey || input.dedupe_key,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: definition.id,
        usageEventKey: input.usageEventKey || input.usage_event_key,
        operationKey: input.operationKey || input.operation_key,
        requestId: input.requestId || input.request_id,
        reasonCode
      });

      if (!dedupeKey) {
        throw new EntitlementsValidationError(
          "consume requires a dedupe identity. Provide dedupeKey, usageEventKey, operationKey, or requestId."
        );
      }

      const previousBalance = await repository.findEntitlementBalance(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: definition.id
        },
        toOptionsWithTransaction(trx)
      );

      const inserted = await repository.insertEntitlementConsumption(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: definition.id,
          amount,
          occurredAt: toDateOrNull(input.occurredAt || input.occurred_at) || normalizeNow(input.now, clock),
          reasonCode,
          operationKey: input.operationKey ?? input.operation_key ?? null,
          usageEventKey: input.usageEventKey ?? input.usage_event_key ?? null,
          providerEventId: input.providerEventId ?? input.provider_event_id ?? null,
          requestId: input.requestId ?? input.request_id ?? null,
          dedupeKey,
          metadataJson: input.metadataJson ?? input.metadata_json ?? null,
          createdAt: input.createdAt ?? input.created_at ?? null
        },
        toOptionsWithTransaction(trx)
      );

      const recomputed = await recompute({
        subjectType: normalizedSubjectType,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: definition.id,
        now: input.now,
        trx,
        capacityConsumedAmount: input.capacityConsumedAmount,
        capacityConsumedAmountResolver: input.capacityConsumedAmountResolver
      });

      return {
        inserted: Boolean(inserted?.inserted),
        definition,
        consumption: inserted?.consumption || null,
        balance: recomputed?.balance || null,
        dedupeKey,
        changed: hasMaterialBalanceChange(normalizeBalanceRow(previousBalance), recomputed?.balance || null)
      };
    });
  }

  async function resolveEffectiveLimitations(subject = {}) {
    const normalizedSubjectType = normalizeSubjectType(subject.subjectType || subject.subject_type || DEFAULT_SUBJECT_TYPE);
    const normalizedSubjectId = toPositiveInteger(subject.subjectId ?? subject.subject_id ?? subject.billableEntityId);
    if (!normalizedSubjectId) {
      throw new EntitlementsValidationError("resolveEffectiveLimitations requires subjectId.");
    }

    const normalizedNow = normalizeNow(subject.now, clock);
    const normalizedCodes = normalizeCodes(subject.limitationCodes ?? subject.codes ?? null);
    const definitionsRaw = await repository.listEntitlementDefinitions(
      {
        includeInactive: false,
        codes: normalizedCodes
      },
      toOptionsWithTransaction(subject.trx || null)
    );

    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw.map(normalizeDefinition).filter(Boolean) : [];
    const capacityResolvers =
      subject.capacityResolvers && typeof subject.capacityResolvers === "object" ? subject.capacityResolvers : {};

    const limitations = [];
    for (const definition of definitions) {
      const previousBalance = await repository.findEntitlementBalance(
        {
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          entitlementDefinitionId: definition.id
        },
        toOptionsWithTransaction(subject.trx || null)
      );

      const recomputed = await recompute({
        subjectType: normalizedSubjectType,
        subjectId: normalizedSubjectId,
        entitlementDefinitionId: definition.id,
        now: normalizedNow,
        trx: subject.trx || null,
        capacityConsumedAmountResolver: capacityResolvers[definition.code]
      });

      const balance = recomputed?.balance || null;
      if (!balance) {
        continue;
      }

      limitations.push({
        code: definition.code,
        entitlementType: definition.entitlementType,
        enforcementMode: definition.enforcementMode,
        unit: definition.unit,
        windowInterval: definition.windowInterval,
        windowAnchor: definition.windowAnchor,
        grantedAmount: Number(balance.grantedAmount || 0),
        consumedAmount: Number(balance.consumedAmount || 0),
        effectiveAmount: Number(balance.effectiveAmount || 0),
        hardLimitAmount: balance.hardLimitAmount == null ? null : Number(balance.hardLimitAmount),
        overLimit: Boolean(balance.overLimit),
        lockState: balance.lockState || null,
        nextChangeAt: balance.nextChangeAt || null,
        windowStartAt: balance.windowStartAt,
        windowEndAt: balance.windowEndAt,
        lastRecomputedAt: balance.lastRecomputedAt,
        _previous: normalizeBalanceRow(previousBalance)
      });
    }

    return {
      subjectType: normalizedSubjectType,
      subjectId: normalizedSubjectId,
      generatedAt: normalizedNow.toISOString(),
      stale: false,
      limitations
    };
  }

  return {
    grant,
    consume,
    recompute,
    resolveEffectiveLimitations
  };
}
