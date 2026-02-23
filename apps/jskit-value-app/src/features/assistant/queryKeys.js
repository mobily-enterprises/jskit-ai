const ASSISTANT_QUERY_KEY_PREFIX = Object.freeze(["assistant"]);

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

function normalizeWorkspaceScope({ workspaceSlug = "", workspaceId = 0 } = {}) {
  const normalizedWorkspaceId = normalizePositiveInteger(workspaceId, 0);
  if (normalizedWorkspaceId > 0) {
    return `id:${normalizedWorkspaceId}`;
  }

  return `slug:${normalizeWorkspaceSlug(workspaceSlug)}`;
}

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || "all";
}

function normalizeConversationId(value) {
  return String(normalizePositiveInteger(value, 0) || "none");
}

function assistantRootQueryKey() {
  return [...ASSISTANT_QUERY_KEY_PREFIX];
}

function assistantWorkspaceScopeQueryKey(workspaceScope = {}) {
  return [...assistantRootQueryKey(), normalizeWorkspaceScope(workspaceScope)];
}

function assistantConversationsListQueryKey(
  workspaceScope = {},
  { page = 1, pageSize = 50, status = "" } = {}
) {
  return [
    ...assistantWorkspaceScopeQueryKey(workspaceScope),
    "conversations",
    "list",
    normalizePositiveInteger(page, 1),
    normalizePositiveInteger(pageSize, 50),
    normalizeStatus(status)
  ];
}

function assistantConversationMessagesQueryKey(
  workspaceScope = {},
  conversationId,
  { page = 1, pageSize = 500 } = {}
) {
  return [
    ...assistantWorkspaceScopeQueryKey(workspaceScope),
    "conversations",
    normalizeConversationId(conversationId),
    "messages",
    normalizePositiveInteger(page, 1),
    normalizePositiveInteger(pageSize, 500)
  ];
}

export {
  ASSISTANT_QUERY_KEY_PREFIX,
  assistantRootQueryKey,
  assistantWorkspaceScopeQueryKey,
  assistantConversationsListQueryKey,
  assistantConversationMessagesQueryKey
};
