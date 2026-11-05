import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { jsonApiNextCursor, simplifyJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { resolveActionUser } from "@jskit-ai/users-core/server/resolveActionUser";

const REWARDED_SURFACE = "app";
// json-rest-api's largest page.
const RECEIPT_PAGE_SIZE = 100;

function normalizeRecordList(document) {
  const simplified = simplifyJsonApiDocument(document);
  return Array.isArray(simplified) ? simplified.filter(Boolean) : [];
}

function normalizeRecord(document) {
  const simplified = simplifyJsonApiDocument(document);
  return simplified && typeof simplified === "object" && !Array.isArray(simplified) ? simplified : null;
}

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
/** @typedef {{ context: object, trx?: import("@jskit-ai/database-runtime/server/types").RuntimeKnexTransaction }} RewardedRepositoryOptions */

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
   * @param {CrudRepository} repository
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function listRecords(repository, query, repositoryOptions) {
    return normalizeRecordList(await repository.queryDocuments(query, repositoryOptions));
  }

  /**
   * @param {CrudRepository} repository
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function queryFirst(repository, query, repositoryOptions) {
    return (await listRecords(repository, query, repositoryOptions))[0] || null;
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveRule(gateKey, repositoryOptions) {
    return queryFirst(rewardedRulesRepository, {
      gateKey,
      enabled: "true",
      surface: REWARDED_SURFACE,
      sort: ["-updatedAt"],
      limit: 1
    }, repositoryOptions);
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveProviderConfig(repositoryOptions) {
    return queryFirst(rewardedProviderConfigsRepository, {
      surface: REWARDED_SURFACE,
      enabled: "true",
      sort: ["-updatedAt"],
      limit: 1
    }, repositoryOptions);
  }

  /** @param {RewardedRepositoryOptions} repositoryOptions */
  async function resolveUnlockReceipts(gateKey, repositoryOptions) {
    return listRecords(rewardedUnlockReceiptsRepository, {
      gateKey,
      sort: ["-grantedAt"],
      limit: 25
    }, repositoryOptions);
  }

  /**
   * How many of the gate's receipts were granted since `since`, read a page at
   * a time until no page follows or the count reaches the daily limit, so the
   * count is exact for any daily limit.
   * @param {RewardedRepositoryOptions} repositoryOptions
   */
  async function countReceiptsGrantedSince(gateKey, since, dailyLimit, repositoryOptions) {
    let count = 0;
    let cursor = null;
    do {
      const document = await rewardedUnlockReceiptsRepository.queryDocuments({
        gateKey,
        grantedSince: since.toISOString(),
        limit: RECEIPT_PAGE_SIZE,
        ...(cursor ? { cursor } : {})
      }, repositoryOptions);
      count += normalizeRecordList(document).length;
      cursor = jsonApiNextCursor(document);
    } while (cursor && count < dailyLimit);
    return count;
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
    const receipts = await resolveUnlockReceipts(gateKey, { context });
    const activeReceiptRecord = receipts.find((entry) => isFutureDate(entry?.unlockedUntil, now)) || null;
    const activeUnlock = formatUnlockReceipt(activeReceiptRecord);

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

    const latestReceipt = receipts[0] || null;
    let cooldownUntil = null;
    if (latestReceipt && Number(rule.cooldownMinutes || 0) > 0) {
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
      const todaysCount = await countReceiptsGrantedSince(gateKey, startOfUtcDay(now), rule.dailyLimit, { context });
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

    const createdSession = normalizeRecord(await rewardedWatchSessionsRepository.createDocument(
      {
        gateKey: state.gateKey,
        providerConfigId: state.providerConfig?.id || null,
        status: "started",
        startedAt: new Date().toISOString()
      },
      { context }
    ));

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

    return rewardedWatchSessionsRepository.withTransaction(async (trx) => {
      const sessionRecord = normalizeRecord(await rewardedWatchSessionsRepository.getDocumentById(sessionId, {}, { context, trx }));
      if (!sessionRecord) {
        throw new AppError(404, "Watch session not found.", { code: "rewarded.session.notFound" });
      }

      const authorized = await grantPolicy.authorizeGrant({
        session: formatWatchSession(sessionRecord),
        context,
        trx
      });
      if (authorized !== true) {
        throw new AppError(403, "Reward grant is not authorized.", { code: "rewarded.session.grantNotAuthorized" });
      }

      if (normalizeText(sessionRecord.status).toLowerCase() === "closed") {
        throw new AppError(409, "Watch session is already closed.", { code: "rewarded.session.closed" });
      }
      if (sessionRecord.rewardedAt || normalizeText(sessionRecord.status).toLowerCase() === "rewarded") {
        const receiptRecord = await queryFirst(rewardedUnlockReceiptsRepository, {
          watchSessionId: sessionId,
          sort: ["-grantedAt"],
          limit: 1
        }, { context, trx });
        return {
          unlocked: true,
          workspaceSlug,
          gateKey: normalizeText(sessionRecord.gateKey),
          unlock: formatUnlockReceipt(receiptRecord),
          session: formatWatchSession(sessionRecord)
        };
      }

      const ruleRecord = await resolveRule(normalizeText(sessionRecord.gateKey), { context, trx });
      if (!ruleRecord) {
        throw new AppError(409, "No rewarded rule is configured for this session.", {
          code: "rewarded.session.ruleMissing"
        });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const unlockedUntil = addMinutes(now, Number(ruleRecord.unlockMinutes || 0));

      const updatedSession = normalizeRecord(await rewardedWatchSessionsRepository.patchDocumentById(
        sessionId,
        {
          status: "rewarded",
          rewardedAt: nowIso,
          completedAt: nowIso
        },
        { context, trx }
      ));

      const createdReceipt = normalizeRecord(await rewardedUnlockReceiptsRepository.createDocument(
        {
          gateKey: normalizeText(sessionRecord.gateKey),
          providerConfigId: sessionRecord.providerConfigId || null,
          watchSessionId: sessionId,
          grantedAt: nowIso,
          unlockedUntil: unlockedUntil.toISOString()
        },
        { context, trx }
      ));

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

    const sessionRecord = normalizeRecord(await rewardedWatchSessionsRepository.getDocumentById(sessionId, {}, { context }));
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

    const closedSession = normalizeRecord(await rewardedWatchSessionsRepository.patchDocumentById(
      sessionId,
      {
        status: "closed",
        closedAt: new Date().toISOString()
      },
      { context }
    ));

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
