import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveActionUser } from "@jskit-ai/users-core/server/resolveActionUser";

const REWARDED_SURFACE = "app";

/**
 * Lower-case text, or the fallback when there is none.
 * @param {unknown} value
 * @param {string} fallback
 */
function normalizeKeyword(value, fallback) {
  return normalizeText(value).toLowerCase() || fallback;
}

function toIsoOrNull(value) {
  return parseDate(value)?.toISOString() ?? null;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutes(date, minutes) {
  const amount = Number(minutes || 0);
  return new Date(date.getTime() + Math.max(0, amount) * 60 * 1000);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function requireActor(context, input) {
  const actor = resolveActionUser(context, input);
  const actorId = actor?.id == null ? "" : String(actor.id).trim();
  if (!actorId) {
    throw new AppError(401, "Authentication required.", { code: "rewarded.auth.required" });
  }
  return actor;
}

function requireWorkspaceSlug(input) {
  const workspaceSlug = normalizeText(input.workspaceSlug).toLowerCase();
  if (!workspaceSlug) {
    throw new AppError(400, "workspaceSlug is required.", { code: "rewarded.request.workspaceSlugRequired" });
  }
  return workspaceSlug;
}

function requireGateKey(input) {
  const gateKey = normalizeText(input.gateKey);
  if (!gateKey) {
    throw new AppError(400, "gateKey is required.", { code: "rewarded.request.gateKeyRequired" });
  }
  return gateKey;
}

function formatRule(rule) {
  if (!rule) {
    return null;
  }

  return {
    id: rule.id || null,
    gateKey: normalizeText(rule.gateKey),
    surface: normalizeKeyword(rule.surface, REWARDED_SURFACE),
    enabled: rule.enabled === true,
    unlockMinutes: Number(rule.unlockMinutes || 0),
    cooldownMinutes: Number(rule.cooldownMinutes || 0),
    dailyLimit: rule.dailyLimit == null ? null : Number(rule.dailyLimit),
    title: normalizeText(rule.title),
    description: normalizeText(rule.description)
  };
}

function formatProviderConfig(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    surface: normalizeKeyword(record.surface, REWARDED_SURFACE),
    enabled: record.enabled === true,
    placement: normalizeText(record.placement),
    provider: normalizeText(record.provider)
  };
}

function formatWatchSession(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    gateKey: normalizeText(record.gateKey),
    providerConfigId: record.providerConfigId || null,
    status: normalizeKeyword(record.status, "started"),
    startedAt: toIsoOrNull(record.startedAt),
    rewardedAt: toIsoOrNull(record.rewardedAt),
    completedAt: toIsoOrNull(record.completedAt),
    closedAt: toIsoOrNull(record.closedAt)
  };
}

function formatUnlockReceipt(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    gateKey: normalizeText(record.gateKey),
    providerConfigId: record.providerConfigId || null,
    watchSessionId: record.watchSessionId || null,
    grantedAt: toIsoOrNull(record.grantedAt),
    unlockedUntil: toIsoOrNull(record.unlockedUntil)
  };
}

function isFutureDate(value, now) {
  const date = parseDate(value);
  return !!date && date.getTime() > now.getTime();
}

/** @typedef {import("@jskit-ai/crud-core/server/types").CrudRepository} CrudRepository */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} RewardedRepositoryOptions */

/**
 * The Rewarded gate workflow over its four resources' repositories and the
 * application's grant policy. Each operation takes the validated input and
 * `{ context }`, the action context.
 * @param {object} dependencies
 * @param {import("./types.js").RewardedGrantPolicy} dependencies.grantPolicy
 * @param {CrudRepository} dependencies.rewardedRulesRepository
 * @param {CrudRepository} dependencies.rewardedProviderConfigsRepository
 * @param {CrudRepository} dependencies.rewardedWatchSessionsRepository
 * @param {CrudRepository} dependencies.rewardedUnlockReceiptsRepository
 */
function createService({
  grantPolicy,
  rewardedRulesRepository,
  rewardedProviderConfigsRepository,
  rewardedWatchSessionsRepository,
  rewardedUnlockReceiptsRepository
}) {
  /**
   * The newest record the filters match, or null.
   * @param {CrudRepository} repository
   * @param {Record<string, unknown>} filters
   * @param {string} newestFirst The sort that puts the newest record first.
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function queryFirst(repository, filters, newestFirst, repositoryOptions) {
    const { records } = await repository.query({ filters, sort: [newestFirst], page: { size: 1 } }, repositoryOptions);
    return records[0] || null;
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveRule(gateKey, repositoryOptions) {
    return queryFirst(rewardedRulesRepository, { gateKey, enabled: true, surface: REWARDED_SURFACE }, "-updatedAt", repositoryOptions);
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveProviderConfig(repositoryOptions) {
    return queryFirst(rewardedProviderConfigsRepository, { surface: REWARDED_SURFACE, enabled: true }, "-updatedAt", repositoryOptions);
  }

  /**
   * The gate's most recently granted receipt that still unlocks it at `now`, however many receipts came after it.
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function resolveActiveUnlockReceipt(gateKey, now, repositoryOptions) {
    const filters = { gateKey, unlockedAfter: now.toISOString() };
    const receipt = await queryFirst(rewardedUnlockReceiptsRepository, filters, "-grantedAt", repositoryOptions);
    return isFutureDate(receipt?.unlockedUntil, now) ? receipt : null;
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveLatestUnlockReceipt(gateKey, repositoryOptions) {
    return queryFirst(rewardedUnlockReceiptsRepository, { gateKey }, "-grantedAt", repositoryOptions);
  }

  /**
   * How many of the gate's receipts were granted since `since`, counted in one
   * query, so the count is exact for any daily limit.
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function countReceiptsGrantedSince(gateKey, since, repositoryOptions) {
    const [totals] = await rewardedUnlockReceiptsRepository.aggregate({
      measures: { granted: { count: "*" } },
      filters: { gateKey, grantedSince: since.toISOString() }
    }, repositoryOptions);
    return Number(totals?.granted || 0);
  }

  async function evaluateGate(input, context) {
    requireActor(context, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const gateKey = requireGateKey(input);
    const surface = REWARDED_SURFACE;
    const now = new Date();

    const ruleRecord = await resolveRule(gateKey, { context });

    if (!ruleRecord) {
      return {
        gateKey,
        workspaceSlug,
        surface,
        enabled: false,
        available: false,
        blocked: false,
        reason: "rule-not-configured",
        rule: null,
        providerConfig: null,
        unlock: null,
        cooldownUntil: null,
        dailyLimitRemaining: null
      };
    }

    const providerConfigRecord = await resolveProviderConfig({ context });
    if (!providerConfigRecord) {
      return {
        gateKey,
        workspaceSlug,
        surface,
        enabled: false,
        available: false,
        blocked: false,
        reason: "provider-not-configured",
        rule: formatRule(ruleRecord),
        providerConfig: null,
        unlock: null,
        cooldownUntil: null,
        dailyLimitRemaining: null
      };
    }

    const rule = formatRule(ruleRecord);
    const providerConfig = formatProviderConfig(providerConfigRecord);
    const activeUnlock = formatUnlockReceipt(await resolveActiveUnlockReceipt(gateKey, now, { context }));

    if (activeUnlock) {
      return {
        gateKey,
        workspaceSlug,
        surface,
        enabled: true,
        available: true,
        blocked: false,
        reason: "already-unlocked",
        rule,
        providerConfig,
        unlock: activeUnlock,
        cooldownUntil: null,
        dailyLimitRemaining: rule.dailyLimit
      };
    }

    // Only a cooldown needs the latest receipt.
    const latestReceipt = Number(rule.cooldownMinutes || 0) > 0 ? await resolveLatestUnlockReceipt(gateKey, { context }) : null;
    let cooldownUntil = null;
    if (latestReceipt) {
      cooldownUntil = addMinutes(parseDate(latestReceipt.grantedAt) || now, rule.cooldownMinutes);
      if (cooldownUntil.getTime() > now.getTime()) {
        return {
          gateKey,
          workspaceSlug,
          surface,
          enabled: true,
          available: false,
          blocked: false,
          reason: "cooldown-active",
          rule,
          providerConfig,
          unlock: null,
          cooldownUntil: cooldownUntil.toISOString(),
          dailyLimitRemaining: rule.dailyLimit
        };
      }
    }

    if (rule.dailyLimit != null) {
      const todaysCount = await countReceiptsGrantedSince(gateKey, startOfUtcDay(now), { context });
      const remaining = Math.max(0, Number(rule.dailyLimit) - todaysCount);
      if (remaining < 1) {
        return {
          gateKey,
          workspaceSlug,
          surface,
          enabled: true,
          available: false,
          blocked: false,
          reason: "daily-limit-reached",
          rule,
          providerConfig,
          unlock: null,
          cooldownUntil: null,
          dailyLimitRemaining: 0
        };
      }

      return {
        gateKey,
        workspaceSlug,
        surface,
        enabled: true,
        available: true,
        blocked: true,
        reason: "reward-required",
        rule,
        providerConfig,
        unlock: null,
        cooldownUntil: null,
        dailyLimitRemaining: remaining
      };
    }

    return {
      gateKey,
      workspaceSlug,
      surface,
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule,
      providerConfig,
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null
    };
  }

  async function getCurrentState(input, { context }) {
    return evaluateGate(input, context);
  }

  async function startGate(input, { context }) {
    const state = await evaluateGate(input, context);
    if (!state.enabled || !state.available || !state.blocked) {
      return {
        ...state,
        session: null
      };
    }

    const createdSession = await rewardedWatchSessionsRepository.create(
      {
        gateKey: state.gateKey,
        providerConfigId: state.providerConfig?.id || null,
        status: "started",
        startedAt: new Date().toISOString()
      },
      { context }
    );

    return {
      ...state,
      session: formatWatchSession(createdSession)
    };
  }

  async function grantReward(input, { context }) {
    requireActor(context, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const sessionId = input.sessionId == null ? "" : String(input.sessionId).trim();
    if (!sessionId) {
      throw new AppError(400, "sessionId is required.", { code: "rewarded.request.sessionIdRequired" });
    }

    return rewardedWatchSessionsRepository.withTransaction({ context }, async (txOptions) => {
      const sessionRecord = await rewardedWatchSessionsRepository.get(sessionId, {}, { ...txOptions, missing: "skip" });
      if (!sessionRecord) {
        throw new AppError(404, "Watch session not found.", { code: "rewarded.session.notFound" });
      }

      const authorized = await grantPolicy.authorizeGrant({
        session: formatWatchSession(sessionRecord),
        context,
        options: txOptions
      });
      if (authorized !== true) {
        throw new AppError(403, "Reward grant is not authorized.", { code: "rewarded.session.grantNotAuthorized" });
      }

      if (normalizeText(sessionRecord.status).toLowerCase() === "closed") {
        throw new AppError(409, "Watch session is already closed.", { code: "rewarded.session.closed" });
      }
      if (sessionRecord.rewardedAt || normalizeText(sessionRecord.status).toLowerCase() === "rewarded") {
        const receiptRecord = await queryFirst(rewardedUnlockReceiptsRepository, { watchSessionId: sessionId }, "-grantedAt", txOptions);
        return {
          unlocked: true,
          workspaceSlug,
          gateKey: normalizeText(sessionRecord.gateKey),
          unlock: formatUnlockReceipt(receiptRecord),
          session: formatWatchSession(sessionRecord)
        };
      }

      const ruleRecord = await resolveRule(normalizeText(sessionRecord.gateKey), txOptions);
      if (!ruleRecord) {
        throw new AppError(409, "No rewarded rule is configured for this session.", {
          code: "rewarded.session.ruleMissing"
        });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const unlockedUntil = addMinutes(now, Number(ruleRecord.unlockMinutes || 0));

      const updatedSession = await rewardedWatchSessionsRepository.patch(
        sessionId,
        {
          status: "rewarded",
          rewardedAt: nowIso,
          completedAt: nowIso
        },
        txOptions
      );

      const createdReceipt = await rewardedUnlockReceiptsRepository.create(
        {
          gateKey: normalizeText(sessionRecord.gateKey),
          providerConfigId: sessionRecord.providerConfigId || null,
          watchSessionId: sessionId,
          grantedAt: nowIso,
          unlockedUntil: unlockedUntil.toISOString()
        },
        txOptions
      );

      return {
        unlocked: true,
        workspaceSlug,
        gateKey: normalizeText(sessionRecord.gateKey),
        unlock: formatUnlockReceipt(createdReceipt),
        session: formatWatchSession(updatedSession)
      };
    });
  }

  async function closeSession(input, { context }) {
    requireActor(context, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const sessionId = input.sessionId == null ? "" : String(input.sessionId).trim();
    if (!sessionId) {
      throw new AppError(400, "sessionId is required.", { code: "rewarded.request.sessionIdRequired" });
    }

    const sessionRecord = await rewardedWatchSessionsRepository.get(sessionId, {}, { context, missing: "skip" });
    if (!sessionRecord) {
      throw new AppError(404, "Watch session not found.", { code: "rewarded.session.notFound" });
    }

    if (sessionRecord.rewardedAt || normalizeText(sessionRecord.status).toLowerCase() === "rewarded") {
      return {
        closed: false,
        workspaceSlug,
        gateKey: normalizeText(sessionRecord.gateKey),
        session: formatWatchSession(sessionRecord),
        reason: "already-rewarded"
      };
    }

    const closedSession = await rewardedWatchSessionsRepository.patch(
      sessionId,
      {
        status: "closed",
        closedAt: new Date().toISOString()
      },
      { context }
    );

    return {
      closed: true,
      workspaceSlug,
      gateKey: normalizeText(closedSession?.gateKey || sessionRecord.gateKey),
      session: formatWatchSession(closedSession)
    };
  }

  return Object.freeze({
    getCurrentState,
    startGate,
    grantReward,
    closeSession
  });
}

export { createService };
