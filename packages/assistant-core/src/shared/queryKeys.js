const ASSISTANT_QUERY_KEY_PREFIX = Object.freeze(["assistant"]);

function normalizeSurfaceId(value) {
  return String(value || "").trim().toLowerCase() || "none";
}

function normalizeWorkspaceSlug(value) {
  return String(value || "").trim() || "none";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeScopeKey({ targetSurfaceId = "", workspaceSlug = "", workspaceId = 0 } = {}) {
  const normalizedWorkspaceId = normalizePositiveInteger(workspaceId, 0);
  const normalizedSurfaceId = normalizeSurfaceId(targetSurfaceId);
  if (normalizedWorkspaceId > 0) {
    return `${normalizedSurfaceId}:workspace:${normalizedWorkspaceId}`;
  }

  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  if (normalizedWorkspaceSlug !== "none") {
    return `${normalizedSurfaceId}:slug:${normalizedWorkspaceSlug}`;
  }

  return `${normalizedSurfaceId}:global`;
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "all";
}

function normalizeConversationId(value) {
  return String(normalizePositiveInteger(value, 0) || "none");
}

function assistantRootQueryKey() {
  return [...ASSISTANT_QUERY_KEY_PREFIX];
}

function assistantScopeQueryKey(scope = {}) {
  return [...assistantRootQueryKey(), normalizeScopeKey(scope)];
}

function assistantSettingsQueryKey(scope = {}) {
  return [...assistantScopeQueryKey(scope), "settings"];
}

function assistantConversationsListQueryKey(scope = {}, { limit = 20, status = "" } = {}) {
  return [
    ...assistantScopeQueryKey(scope),
    "conversations",
    "list",
    normalizePositiveInteger(limit, 20),
    normalizeStatus(status)
  ];
}

function assistantConversationMessagesQueryKey(scope = {}, conversationId, { page = 1, pageSize = 200 } = {}) {
  return [
    ...assistantScopeQueryKey(scope),
    "conversations",
    normalizeConversationId(conversationId),
    "messages",
    normalizePositiveInteger(page, 1),
    normalizePositiveInteger(pageSize, 200)
  ];
}

export {
  ASSISTANT_QUERY_KEY_PREFIX,
  assistantRootQueryKey,
  assistantScopeQueryKey,
  assistantSettingsQueryKey,
  assistantConversationsListQueryKey,
  assistantConversationMessagesQueryKey
};
