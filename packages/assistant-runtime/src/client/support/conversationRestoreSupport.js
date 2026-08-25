import { MAX_MESSAGE_PAGE_SIZE } from "@jskit-ai/assistant-core/shared";

const DEFAULT_RESTORE_MESSAGES_PAGE_SIZE = 200;
const DEFAULT_RESTORE_MESSAGES_MAX_ENTRIES = 2000;
const MAX_RESTORE_MESSAGES_MAX_ENTRIES = 5000;

function normalizeBoundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeTotalPages(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function resolveConversationRestorePolicy({ pageSize, maxEntries } = {}) {
  return Object.freeze({
    pageSize: normalizeBoundedPositiveInteger(
      pageSize,
      DEFAULT_RESTORE_MESSAGES_PAGE_SIZE,
      MAX_MESSAGE_PAGE_SIZE
    ),
    maxEntries: normalizeBoundedPositiveInteger(
      maxEntries,
      DEFAULT_RESTORE_MESSAGES_MAX_ENTRIES,
      MAX_RESTORE_MESSAGES_MAX_ENTRIES
    )
  });
}

async function loadConversationTranscript({
  fetchPage,
  pageSize = DEFAULT_RESTORE_MESSAGES_PAGE_SIZE,
  maxEntries = DEFAULT_RESTORE_MESSAGES_MAX_ENTRIES
} = {}) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("loadConversationTranscript requires fetchPage().");
  }

  const restorePolicy = resolveConversationRestorePolicy({ pageSize, maxEntries });
  const normalizedPageSize = restorePolicy.pageSize;
  const normalizedMaxEntries = restorePolicy.maxEntries;
  const firstResponse = await fetchPage(1, normalizedPageSize);
  const totalPages = normalizeTotalPages(firstResponse?.totalPages);
  const restoredPageCount = Math.max(1, Math.ceil(normalizedMaxEntries / normalizedPageSize));
  const firstRestoredPage = Math.max(1, totalPages - restoredPageCount + 1);
  const entries = firstRestoredPage === 1 && Array.isArray(firstResponse?.entries)
    ? [...firstResponse.entries]
    : [];

  for (let page = Math.max(2, firstRestoredPage); page <= totalPages; page += 1) {
    const response = await fetchPage(page, normalizedPageSize);
    if (Array.isArray(response?.entries)) {
      entries.push(...response.entries);
    }
  }

  return Object.freeze({
    entries: Object.freeze(entries.slice(-normalizedMaxEntries)),
    firstRestoredPage,
    pageSize: normalizedPageSize,
    totalPages,
    truncated: firstRestoredPage > 1
  });
}

export {
  loadConversationTranscript,
  resolveConversationRestorePolicy
};
