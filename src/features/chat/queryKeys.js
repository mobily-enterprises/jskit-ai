const CHAT_QUERY_KEY_PREFIX = Object.freeze(["chat"]);

function normalizeWorkspaceSlug(workspaceSlug) {
  return String(workspaceSlug || "").trim() || "none";
}

function normalizeThreadId(threadId) {
  const parsed = Number(threadId);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return "none";
  }
  return String(parsed);
}

function normalizeLimit(limit, fallback) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function chatRootQueryKey() {
  return [...CHAT_QUERY_KEY_PREFIX];
}

function chatScopeQueryKey(workspaceSlug) {
  return [...chatRootQueryKey(), normalizeWorkspaceSlug(workspaceSlug)];
}

function chatInboxInfiniteQueryKey(workspaceSlug, { limit = 20 } = {}) {
  return [...chatScopeQueryKey(workspaceSlug), "inbox", "infinite", normalizeLimit(limit, 20)];
}

function chatThreadQueryKey(workspaceSlug, threadId) {
  return [...chatScopeQueryKey(workspaceSlug), "threads", normalizeThreadId(threadId)];
}

function chatThreadMessagesInfiniteQueryKey(workspaceSlug, threadId, { limit = 50 } = {}) {
  return [...chatThreadQueryKey(workspaceSlug, threadId), "messages", "infinite", normalizeLimit(limit, 50)];
}

export {
  CHAT_QUERY_KEY_PREFIX,
  chatRootQueryKey,
  chatScopeQueryKey,
  chatInboxInfiniteQueryKey,
  chatThreadQueryKey,
  chatThreadMessagesInfiniteQueryKey
};
