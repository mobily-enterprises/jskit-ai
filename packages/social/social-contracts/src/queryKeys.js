const SOCIAL_QUERY_KEY_PREFIX = Object.freeze(["social"]);

function normalizeWorkspaceSlug(workspaceSlug) {
  return String(workspaceSlug || "").trim() || "none";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function normalizeCursor(value) {
  const normalized = String(value || "").trim();
  return normalized || "none";
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function socialRootQueryKey() {
  return [...SOCIAL_QUERY_KEY_PREFIX];
}

function socialScopeQueryKey(workspaceSlug) {
  return [...socialRootQueryKey(), normalizeWorkspaceSlug(workspaceSlug)];
}

function socialFeedQueryKey(workspaceSlug, { cursor = "", limit = 20 } = {}) {
  return [
    ...socialScopeQueryKey(workspaceSlug),
    "feed",
    normalizeCursor(cursor),
    normalizePositiveInteger(limit, 20)
  ];
}

function socialPostQueryKey(workspaceSlug, postId) {
  return [
    ...socialScopeQueryKey(workspaceSlug),
    "posts",
    normalizePositiveInteger(postId, 0) || "none"
  ];
}

function socialNotificationsQueryKey(workspaceSlug, { unreadOnly = false, limit = 30 } = {}) {
  return [
    ...socialScopeQueryKey(workspaceSlug),
    "notifications",
    unreadOnly ? "unread" : "all",
    normalizePositiveInteger(limit, 30)
  ];
}

function socialActorSearchQueryKey(workspaceSlug, { query = "", limit = 20 } = {}) {
  return [
    ...socialScopeQueryKey(workspaceSlug),
    "actors",
    "search",
    normalizeText(query, "none").toLowerCase(),
    normalizePositiveInteger(limit, 20)
  ];
}

export {
  SOCIAL_QUERY_KEY_PREFIX,
  socialRootQueryKey,
  socialScopeQueryKey,
  socialFeedQueryKey,
  socialPostQueryKey,
  socialNotificationsQueryKey,
  socialActorSearchQueryKey
};
