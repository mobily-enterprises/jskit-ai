// Original paged transcript representation, shared by all browser bindings.
const CONVERSATION_LOG_PAGE_LIMIT = 20;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeConversationLogPagination(pagination = {}) {
  const source = isRecord(pagination) ? pagination : {};
  return {
    beforeTurnId: String(source.beforeTurnId || "").trim(),
    count: Number.isFinite(Number(source.count)) ? Number(source.count) : 0,
    hasMoreBefore: source.hasMoreBefore === true,
    limit: Number.isFinite(Number(source.limit)) ? Number(source.limit) : 0,
    newestTurnId: String(source.newestTurnId || "").trim(),
    nextBeforeTurnId: String(source.nextBeforeTurnId || "").trim(),
    oldestTurnId: String(source.oldestTurnId || "").trim(),
    totalTurnCount: Number.isFinite(Number(source.totalTurnCount)) ? Number(source.totalTurnCount) : 0
  };
}

function normalizeConversationLogPage(payload = {}) {
  const source = isRecord(payload) ? payload : {};
  const conversationLog = Array.isArray(source.conversationLog) ? source.conversationLog : [];
  const pagination = normalizeConversationLogPagination(source.pagination);
  return {
    ...source,
    conversationLog,
    pagination: {
      ...pagination,
      count: pagination.count || conversationLog.length,
      newestTurnId: pagination.newestTurnId || String(conversationLog.at(-1)?.turnId || "").trim(),
      oldestTurnId: pagination.oldestTurnId || String(conversationLog[0]?.turnId || "").trim()
    }
  };
}

function mergeConversationLogPages(pages = []) {
  const orderedTurns = [];
  const indexes = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    const normalized = normalizeConversationLogPage(page);
    for (const turn of normalized.conversationLog) {
      const turnId = String(turn?.turnId || "").trim();
      if (!turnId) {
        orderedTurns.push(turn);
        continue;
      }
      if (indexes.has(turnId)) {
        orderedTurns[indexes.get(turnId)] = turn;
        continue;
      }
      indexes.set(turnId, orderedTurns.length);
      orderedTurns.push(turn);
    }
  }
  return {
    conversationLog: orderedTurns
  };
}

function conversationLogReadQuery({
  beforeTurnId = "",
  limit = CONVERSATION_LOG_PAGE_LIMIT
} = {}) {
  return {
    ...(beforeTurnId ? { beforeTurnId } : {}),
    limit: String(limit)
  };
}

export {
  CONVERSATION_LOG_PAGE_LIMIT,
  normalizeConversationLogPagination,
  normalizeConversationLogPage,
  mergeConversationLogPages,
  conversationLogReadQuery
};
