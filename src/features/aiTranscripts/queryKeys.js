const WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX = Object.freeze(["workspace-ai-transcripts"]);

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

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || "all";
}

function normalizeConversationId(value) {
  return String(normalizePositiveInteger(value, 0) || "none");
}

function workspaceAiTranscriptsRootQueryKey() {
  return [...WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX];
}

function workspaceAiTranscriptsScopeQueryKey(workspaceSlug) {
  return [...workspaceAiTranscriptsRootQueryKey(), normalizeWorkspaceSlug(workspaceSlug)];
}

function workspaceAiTranscriptsListQueryKey(workspaceSlug, { page = 1, pageSize = 20, status = "" } = {}) {
  return [
    ...workspaceAiTranscriptsScopeQueryKey(workspaceSlug),
    "list",
    normalizePositiveInteger(page, 1),
    normalizePositiveInteger(pageSize, 20),
    normalizeStatus(status)
  ];
}

function workspaceAiTranscriptMessagesQueryKey(workspaceSlug, conversationId, { page = 1, pageSize = 500 } = {}) {
  return [
    ...workspaceAiTranscriptsScopeQueryKey(workspaceSlug),
    "conversation",
    normalizeConversationId(conversationId),
    "messages",
    normalizePositiveInteger(page, 1),
    normalizePositiveInteger(pageSize, 500)
  ];
}

export {
  WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX,
  workspaceAiTranscriptsRootQueryKey,
  workspaceAiTranscriptsScopeQueryKey,
  workspaceAiTranscriptsListQueryKey,
  workspaceAiTranscriptMessagesQueryKey
};
