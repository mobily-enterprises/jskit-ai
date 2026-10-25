import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { conversationTurnMessages } from "./turns.js";

// Original paged transcript representation, shared by all browser bindings.
const CONVERSATION_LOG_PAGE_LIMIT = 10;

const messageRoles = ["system", "user", "assistant"];

// Live updates retain whole boundary turns. Reasoning/progress never uses the
// message allowance, and never evicts the question it follows.
function conversationLogPageStart(turns, limit, end = turns.length) {
  if (!limit) return 0;
  let remaining = limit;
  let start = end;
  while (start > 0 && remaining > 0) {
    start -= 1;
    remaining -= messageRoles.filter(role => turns[start]?.[role]).length;
  }
  return turns.slice(0, start).some(turn => messageRoles.some(role => turn?.[role])) ? start : 0;
}

// A cursor can stop between the question and answer of one stored turn. It is
// read-only presentation state; stored turn and message identities never change.
function conversationLogPage(turns, { beforeTurnId = "", limit = 0 } = {}) {
  const messages = turns.flatMap((turn, index) => messageRoles.filter(role => turn[role])
    .map(role => ({ index, role, turnId: turn.turnId })));
  let boundary = turns.findIndex(turn => turn.turnId === beforeTurnId);
  let beforeRole = "";
  if (boundary < 0 && beforeTurnId.startsWith("message:")) {
    try {
      const [id, role] = JSON.parse(beforeTurnId.slice(8));
      if (messageRoles.includes(role)) {
        boundary = turns.findIndex(turn => turn.turnId === id);
        beforeRole = role;
      }
    } catch { /* An unknown cursor retains the existing latest-page behavior. */ }
  }
  const beforeRoleIndex = beforeRole ? messageRoles.indexOf(beforeRole) : 0;
  const foundEnd = boundary < 0 ? -1 : messages.findIndex(message =>
    message.index > boundary ||
      (message.index === boundary && messageRoles.indexOf(message.role) >= beforeRoleIndex));
  const end = foundEnd < 0 ? messages.length : foundEnd;
  const start = limit > 0 ? Math.max(0, end - limit) : 0;
  const first = messages[start];
  const firstRoleIndex = start > 0 ? messageRoles.indexOf(first.role) : 0;
  const startTurn = start > 0 ? first.index : 0;
  const endTurn = boundary < 0 ? turns.length : boundary + (beforeRole ? 1 : 0);
  const selected = turns.slice(startTurn, endTurn).map((turn, offset) => {
    const index = startTurn + offset;
    const roles = messageRoles.filter(role => turn[role]);
    const fromRole = index === startTurn ? firstRoleIndex : 0;
    const toRole = index === boundary && beforeRole ? beforeRoleIndex : messageRoles.length;
    const keep = roles.filter(role => {
      const position = messageRoles.indexOf(role);
      return position >= fromRole && position < toRole;
    });
    if (keep.length === roles.length) return turn;
    // Progress belongs to the later part of a split turn, next to its answer.
    const keepActivity = keep.includes(roles.at(-1));
    const result = { ...turn, paginationPartial: true,
      thinking: keepActivity ? turn.thinking : [], commentary: keepActivity ? turn.commentary : [] };
    for (const role of messageRoles) if (!keep.includes(role)) result[role] = null;
    result.messages = conversationTurnMessages(turn)
      .filter(message => keep.includes(message.role) || (keepActivity && !messageRoles.includes(message.role)));
    return result;
  }).filter(turn => messageRoles.some(role => turn[role]) || turn.thinking?.length || turn.commentary?.length);
  let nextBeforeTurnId = "";
  if (start > 0) {
    const split = messageRoles.slice(0, firstRoleIndex).some(role => turns[first.index][role]);
    nextBeforeTurnId = split ? `message:${JSON.stringify([first.turnId, first.role])}` : first.turnId;
  }
  return {
    conversationLog: selected,
    hasMoreBefore: start > 0,
    nextBeforeTurnId
  };
}

function normalizeConversationLogPagination(pagination = {}) {
  const source = isRecord(pagination) ? pagination : {};
  return {
    ...(source.pageUnit === "messages" ? { pageUnit: "messages" } : {}),
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
        const index = indexes.get(turnId);
        const previous = orderedTurns[index];
        if (!turn.paginationPartial && !previous.paginationPartial) {
          orderedTurns[index] = turn;
          continue;
        }
        const merged = { ...previous, ...turn };
        for (const role of messageRoles) merged[role] = turn[role] || previous[role];
        const [activity, previousActivity] = [turn, previous].map(part =>
          (part.messages || [...(part.thinking || []), ...(part.commentary || [])])
            .filter(message => !messageRoles.includes(message.role)));
        const retainedActivity = activity.length ? activity : previousActivity;
        merged.thinking = retainedActivity.filter(message => message.role === "thinking");
        merged.commentary = retainedActivity.filter(message => message.role === "commentary");
        merged.messages = [merged.system, merged.user, ...retainedActivity, merged.assistant].filter(Boolean);
        orderedTurns[index] = merged;
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
  conversationLogPageStart,
  conversationLogPage,
  normalizeConversationLogPagination,
  normalizeConversationLogPage,
  mergeConversationLogPages,
  conversationLogReadQuery
};
