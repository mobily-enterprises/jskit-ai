import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { simplifyJsonApiDocument } from "@jskit-ai/http-runtime/shared";

const REWARDED_SURFACE = "app";

function resolveActionUser(context, input) {
  const payload = normalizeObject(input);
  const request = context?.requestMeta?.request || null;
  return payload.user || request?.user || context?.actor || null;
}

function normalizeRecordList(document = null) {
  const simplified = simplifyJsonApiDocument(document);
  return Array.isArray(simplified) ? simplified.filter(Boolean) : [];
}

function normalizeRecord(document = null) {
  const simplified = simplifyJsonApiDocument(document);
  return simplified && typeof simplified === "object" && !Array.isArray(simplified) ? simplified : null;
}

function normalizeGateKey(value = "") {
  return normalizeText(value);
}

function normalizeSurface(value = "", { fallback = REWARDED_SURFACE } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || fallback;
}

function toIsoOrNull(value = null) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDate(value = null) {
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
    throw new AppError(401, "Authentication required.");
  }
  return actor;
}

function requireWorkspaceSlug(input = {}) {
  const workspaceSlug = normalizeText(input?.workspaceSlug).toLowerCase();
  if (!workspaceSlug) {
    throw new AppError(400, "workspaceSlug is required.");
  }
  return workspaceSlug;
}

function requireGateKey(input = {}) {
  const gateKey = normalizeGateKey(input?.gateKey);
  if (!gateKey) {
    throw new AppError(400, "gateKey is required.");
  }
  return gateKey;
}

function formatRule(rule = null) {
  if (!rule) {
    return null;
  }

  return {
    id: rule.id || null,
    gateKey: normalizeGateKey(rule.gateKey),
    surface: normalizeSurface(rule.surface, { fallback: REWARDED_SURFACE }),
    enabled: rule.enabled === true,
    unlockMinutes: Number(rule.unlockMinutes || 0),
    cooldownMinutes: Number(rule.cooldownMinutes || 0),
    dailyLimit: rule.dailyLimit == null ? null : Number(rule.dailyLimit),
    title: normalizeText(rule.title),
    description: normalizeText(rule.description)
  };
}

function formatProviderConfig(record = null) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    surface: normalizeSurface(record.surface, { fallback: REWARDED_SURFACE }),
    enabled: record.enabled === true,
    placement: normalizeText(record.placement),
    provider: normalizeText(record.provider)
  };
}

function formatWatchSession(record = null) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    gateKey: normalizeGateKey(record.gateKey),
    providerConfigId: record.providerConfigId || null,
    status: normalizeSurface(record.status, { fallback: "started" }),
    startedAt: toIsoOrNull(record.startedAt),
    rewardedAt: toIsoOrNull(record.rewardedAt),
    completedAt: toIsoOrNull(record.completedAt),
    closedAt: toIsoOrNull(record.closedAt)
  };
}

function formatUnlockReceipt(record = null) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    gateKey: normalizeGateKey(record.gateKey),
    providerConfigId: record.providerConfigId || null,
    watchSessionId: record.watchSessionId || null,
    grantedAt: toIsoOrNull(record.grantedAt),
    unlockedUntil: toIsoOrNull(record.unlockedUntil)
  };
}

function isFutureDate(value = null, now = new Date()) {
  const date = parseDate(value);
  return !!date && date.getTime() > now.getTime();
}

function createService({
  authorizeGrant,
  rewardedRulesRepository,
  rewardedProviderConfigsRepository,
  rewardedWatchSessionsRepository,
  rewardedUnlockReceiptsRepository
} = {}) {
  if (typeof authorizeGrant !== "function") {
    throw new TypeError("createService requires application authorizeGrant policy.");
  }
  if (!rewardedRulesRepository) {
    throw new TypeError("createService requires rewardedRulesRepository.");
  }
  if (!rewardedProviderConfigsRepository) {
    throw new TypeError("createService requires rewardedProviderConfigsRepository.");
  }
  if (!rewardedWatchSessionsRepository) {
    throw new TypeError("createService requires rewardedWatchSessionsRepository.");
  }
  if (!rewardedUnlockReceiptsRepository) {
    throw new TypeError("createService requires rewardedUnlockReceiptsRepository.");
  }

  async function queryFirst(repository, query = {}, options = {}) {
    const rows = normalizeRecordList(await repository.queryDocuments(query, options));
    return rows[0] || null;
  }

  async function listRecords(repository, query = {}, options = {}) {
    return normalizeRecordList(await repository.queryDocuments(query, options));
  }

  async function resolveRule({ gateKey, surface, context, trx }) {
    const filters = {
      gateKey,
      enabled: "true"
    };
    if (surface) {
      filters.surface = surface;
    }
    return queryFirst(rewardedRulesRepository, {
      ...filters,
      sort: ["-updatedAt"],
      limit: 1
    }, {
      context,
      trx
    });
  }

  async function resolveProviderConfig({ surface, context, trx }) {
    return queryFirst(rewardedProviderConfigsRepository, {
      surface,
      enabled: "true",
      sort: ["-updatedAt"],
      limit: 1
    }, {
      context,
      trx
    });
  }

  async function resolveUnlockReceipts({ gateKey, context, trx, limit = 25 }) {
    return listRecords(rewardedUnlockReceiptsRepository, {
      gateKey,
      sort: ["-grantedAt"],
      limit
    }, {
      context,
      trx
    });
  }

  async function evaluateGate(input = {}, options = {}) {
    requireActor(options?.context || null, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const gateKey = requireGateKey(input);
    const surface = REWARDED_SURFACE;
    const now = new Date();

    const ruleRecord = await resolveRule({
      gateKey,
      surface,
      context: options?.context || null,
      trx: options?.trx || null
    });

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

    const providerConfigRecord = await resolveProviderConfig({
      surface,
      context: options?.context || null,
      trx: options?.trx || null
    });
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
    const receipts = await resolveUnlockReceipts({
      gateKey,
      context: options?.context || null,
      trx: options?.trx || null
    });
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
      const dayStart = startOfUtcDay(now);
      const todaysCount = receipts.filter((entry) => {
        const grantedAt = parseDate(entry?.grantedAt);
        return grantedAt && grantedAt.getTime() >= dayStart.getTime();
      }).length;
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

  async function getCurrentState(input = {}, options = {}) {
    return evaluateGate(input, options);
  }

  async function startGate(input = {}, options = {}) {
    const state = await evaluateGate(input, options);
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
      {
        context: options?.context || null,
        trx: options?.trx || null
      }
    ));

    return {
      ...state,
      session: formatWatchSession(createdSession)
    };
  }

  async function grantReward(input = {}, options = {}) {
    requireActor(options?.context || null, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const sessionId = input?.sessionId == null ? "" : String(input.sessionId).trim();
    if (!sessionId) {
      throw new AppError(400, "sessionId is required.");
    }

    return rewardedWatchSessionsRepository.withTransaction(async (trx) => {
      const sessionRecord = normalizeRecord(await rewardedWatchSessionsRepository.getDocumentById(sessionId, {}, {
        context: options?.context || null,
        trx
      }));
      if (!sessionRecord) {
        throw new AppError(404, "Watch session not found.");
      }

      const authorized = await authorizeGrant({
        session: formatWatchSession(sessionRecord),
        context: options?.context || null,
        trx
      });
      if (authorized !== true) {
        throw new AppError(403, "Reward grant is not authorized.");
      }

      if (normalizeText(sessionRecord.status).toLowerCase() === "closed") {
        throw new AppError(409, "Watch session is already closed.");
      }
      if (sessionRecord.rewardedAt || normalizeText(sessionRecord.status).toLowerCase() === "rewarded") {
        const receiptRecord = await queryFirst(rewardedUnlockReceiptsRepository, {
          watchSessionId: sessionId,
          sort: ["-grantedAt"],
          limit: 1
        }, {
          context: options?.context || null,
          trx
        });
        return {
          unlocked: true,
          workspaceSlug,
          gateKey: normalizeGateKey(sessionRecord.gateKey),
          unlock: formatUnlockReceipt(receiptRecord),
          session: formatWatchSession(sessionRecord)
        };
      }

      const ruleRecord = await resolveRule({
        gateKey: normalizeGateKey(sessionRecord.gateKey),
        surface: REWARDED_SURFACE,
        context: options?.context || null,
        trx
      });
      if (!ruleRecord) {
        throw new AppError(409, "No rewarded rule is configured for this session.");
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
        {
          context: options?.context || null,
          trx
        }
      ));

      const createdReceipt = normalizeRecord(await rewardedUnlockReceiptsRepository.createDocument(
        {
          gateKey: normalizeGateKey(sessionRecord.gateKey),
          providerConfigId: sessionRecord.providerConfigId || null,
          watchSessionId: sessionId,
          grantedAt: nowIso,
          unlockedUntil: unlockedUntil.toISOString()
        },
        {
          context: options?.context || null,
          trx
        }
      ));

      return {
        unlocked: true,
        workspaceSlug,
        gateKey: normalizeGateKey(sessionRecord.gateKey),
        unlock: formatUnlockReceipt(createdReceipt),
        session: formatWatchSession(updatedSession)
      };
    });
  }

  async function closeSession(input = {}, options = {}) {
    requireActor(options?.context || null, input);
    const workspaceSlug = requireWorkspaceSlug(input);
    const sessionId = input?.sessionId == null ? "" : String(input.sessionId).trim();
    if (!sessionId) {
      throw new AppError(400, "sessionId is required.");
    }

    const sessionRecord = normalizeRecord(await rewardedWatchSessionsRepository.getDocumentById(sessionId, {}, {
      context: options?.context || null,
      trx: options?.trx || null
    }));
    if (!sessionRecord) {
      throw new AppError(404, "Watch session not found.");
    }

    if (sessionRecord.rewardedAt || normalizeText(sessionRecord.status).toLowerCase() === "rewarded") {
      return {
        closed: false,
        workspaceSlug,
        gateKey: normalizeGateKey(sessionRecord.gateKey),
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
      {
        context: options?.context || null,
        trx: options?.trx || null
      }
    ));

    return {
      closed: true,
      workspaceSlug,
      gateKey: normalizeGateKey(closedSession?.gateKey || sessionRecord.gateKey),
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
