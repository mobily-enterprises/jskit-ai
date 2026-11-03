import { computed, ref } from "vue";
import {
  conversationTurnMessages,
  mergeConversationLogPages,
  mergeConversationStream,
  normalizeConversationLogPage,
  normalizeConversationLogPagination
} from "@jskit-ai/assistant-core/shared/conversation";
import { failureMessage, isAccessDenied } from "../support/conversationFailures.js";
import { patchLoadedHistoryPages, refreshedHistoryPages } from "../support/subscribeAssistantConversation.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const compareTurnIds = (left, right) => String(left).localeCompare(String(right), undefined, { numeric: true });

/** A Load older request whose view does not follow the result. */
function ignoreLoadResult() {}

/**
 * The saved history a conversation's views have loaded: the live page from its subscription plus the older pages a
 * reader asked for, kept apart so a canonical read can refresh both.
 * @param {{
 *   api: import("@jskit-ai/assistant-core/client/types").AssistantApi,
 *   identity: import("../types.js").ConversationIdentity,
 *   snapshot: import("vue").ShallowRef<any>,
 *   current: import("vue").ComputedRef<boolean>,
 *   listening: import("vue").ComputedRef<boolean>,
 *   available: import("vue").ComputedRef<boolean>,
 *   receiveError: (failure: any) => void
 * }} conversation
 */
function createConversationHistory({ api, identity, snapshot, current, listening, available, receiveError }) {
  const olderPages = ref([]);
  let historyRevision = 0;
  let deniedHistoryRevision = 0;
  const loadingMore = ref(false);
  const loadMoreError = ref("");
  const turns = computed(() => {
    const saved = mergeConversationLogPages([
      ...olderPages.value, { conversationLog: snapshot.value?.conversationLog || [] }
    ]).conversationLog;
    // Use the original overlay against the full loaded saved span. A synthetic
    // live older turn must not replace its authored request or saved progress.
    const messages = (snapshot.value?.turns || []).flatMap(conversationTurnMessages);
    return mergeConversationStream(saved, { messages });
  });
  const oldestLoadedPage = computed(() => olderPages.value[0] || snapshot.value);
  const hasMoreBefore = computed(() => normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).hasMoreBefore);

  /**
   * Takes the older pages a new state brings, before the live page is replaced by it.
   * @param {any} state
   * @param {any} previous The live page the state replaces.
   * @param {{ initial: boolean, canonical: boolean }} options
   */
  function receiveState(state, previous, { initial, canonical }) {
    if (canonical) {
      historyRevision += 1;
      olderPages.value = initial ? [] : state[refreshedHistoryPages] || [];
      loadMoreError.value = "";
    } else if (olderPages.value.length) {
      // Transcript patches may evict the head of the bounded live page before
      // its canonical read completes. Retain saved rows, never display overlays.
      const first = state.conversationLog?.[0]?.turnId;
      const evicted = first ? (previous?.conversationLog || []).filter(turn => compareTurnIds(turn.turnId, first) < 0) : [];
      if (evicted.length) {
        historyRevision += 1;
        olderPages.value = [...olderPages.value, normalizeConversationLogPage({ conversationLog: evicted })];
      }
    }
  }
  /**
   * Applies a transcript event to the older page that holds its turn.
   * @param {any} event
   */
  function receivePatch(event) {
    if (event.type === "transcript" && olderPages.value.some(page =>
      page.conversationLog.some(turn => turn.turnId === event.patch?.turn?.turnId))) {
      historyRevision += 1;
      olderPages.value = patchLoadedHistoryPages(olderPages.value, event.patch);
    }
  }
  /** Drops the older pages, as when the view is cleared. */
  function clear() {
    historyRevision += 1;
    olderPages.value = [];
  }
  /** Makes a read in flight stale, as when the subscription restarts. */
  function invalidate() {
    historyRevision += 1;
  }
  /** Makes a read in flight fail as denied, after the viewer lost access. */
  function deny() {
    deniedHistoryRevision += 1;
  }

  /**
   * Rereads the live page and every older page already loaded, for the subscription's canonical read.
   * @param {{ current: () => boolean }} read Whether the subscription still wants this read.
   */
  async function readLoadedHistory({ current: subscriptionCurrent }) {
    const denial = deniedHistoryRevision;
    const valid = () => {
      if (denial !== deniedHistoryRevision) {
        throw Object.assign(new Error("Access denied."), { status: 403, messageCode: "assistant.runtime.accessDenied" });
      }
      return current.value && listening.value && subscriptionCurrent();
    };
    // A concurrent Load older operation extends the desired span. Retry one
    // refresh in this same read, rather than dropping that newly loaded page.
    while (valid()) {
      const revision = historyRevision;
      const oldestTurn = olderPages.value[0]?.conversationLog?.[0];
      const oldest = oldestTurn?.turnId;
      const oldestCursor = olderPages.value[0]?.pagination?.nextBeforeTurnId || oldest;
      const latest = await api.readConversation(identity.conversationId);
      if (!valid()) return latest;
      const pages = [];
      let page = normalizeConversationLogPage(latest);
      const cursors = new Set();
      while (oldest && page.pagination.hasMoreBefore) {
        const cursor = page.pagination.nextBeforeTurnId || page.pagination.oldestTurnId;
        const reachedFullOldestTurn = page.pagination.oldestTurnId === oldest && !page.conversationLog[0]?.paginationPartial;
        const passedOldestTurn = compareTurnIds(page.pagination.oldestTurnId, oldest) < 0;
        if (cursor && (cursor === oldestCursor || passedOldestTurn || reachedFullOldestTurn)) break;
        if (!cursor || cursors.has(cursor)) {
          throw Object.assign(new Error("Older conversation history could not be refreshed. Reload chat to try again."), {
            messageCode: "assistant.runtime.history.refreshFailed"
          });
        }
        cursors.add(cursor);
        page = normalizeConversationLogPage(await api.readConversation(identity.conversationId, {
          beforeTurnId: cursor, limit: latest.pagination.limit
        }));
        if (!valid()) return latest;
        // A removed oldest row can make this page reach farther back than the
        // reader loaded. Keep the original visible boundary and page metadata.
        const saved = page.conversationLog.filter(turn => compareTurnIds(turn.turnId, oldest) >= 0).map(turn => {
          if (turn.turnId !== oldest || !oldestTurn.paginationPartial) return turn;
          const roles = ["system", "user", "assistant"];
          const excluded = roles.slice(0, roles.findIndex(role => oldestTurn[role]));
          return { ...turn, paginationPartial: true,
            ...Object.fromEntries(excluded.map(role => [role, null])),
            messages: turn.messages?.filter(message => !excluded.includes(message.role)) };
        });
        pages.unshift(normalizeConversationLogPage({ ...page, conversationLog: saved, pagination: {
          ...page.pagination, count: saved.length, oldestTurnId: saved[0]?.turnId || "",
          hasMoreBefore: page.pagination.hasMoreBefore || saved.length < page.conversationLog.length
        } }));
      }
      if (revision !== historyRevision) continue;
      return { ...latest, [refreshedHistoryPages]: pages.filter(page => page.conversationLog.length) };
    }
    return null;
  }

  /**
   * Loads the page before the oldest loaded turn, kept separate from the live page.
   * @param {{ complete?: (result: { changed: boolean, loaded: boolean }) => void }} [options]
   */
  async function loadMore({ complete = ignoreLoadResult } = {}) {
    const pagination = normalizeConversationLogPagination(oldestLoadedPage.value?.pagination);
    const beforeTurnId = pagination.nextBeforeTurnId || pagination.oldestTurnId ||
      String(turns.value[0]?.turnId || "").trim();
    if (!available.value || !hasMoreBefore.value || loadingMore.value || !beforeTurnId) {
      complete({ changed: false, loaded: false });
      return false;
    }
    const revision = historyRevision;
    loadingMore.value = true;
    loadMoreError.value = "";
    try {
      const page = await api.readConversation(identity.conversationId, {
        beforeTurnId, limit: snapshot.value.pagination.limit
      });
      if (!available.value || revision !== historyRevision) {
        complete({ changed: false, loaded: false });
        return false;
      }
      const previousOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      const previousMessageCount = turns.value.reduce((count, turn) => count + (turn.messages?.length || 0), 0);
      historyRevision += 1;
      olderPages.value = [normalizeConversationLogPage(page), ...olderPages.value];
      const nextOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      const nextMessageCount = turns.value.reduce((count, turn) => count + (turn.messages?.length || 0), 0);
      const changed = Boolean(nextOldestTurnId && (nextOldestTurnId !== previousOldestTurnId ||
        nextMessageCount !== previousMessageCount));
      complete({ changed, loaded: true });
      return true;
    } catch (failure) {
      if (current.value) {
        loadMoreError.value = String(failureMessage(failure) || failure || t("jskit.assistant.runtime.history.loadFailed"));
        if (isAccessDenied(failure)) receiveError(failure);
      }
      complete({ changed: false, loaded: false });
      return false;
    } finally { loadingMore.value = false; }
  }

  return {
    turns,
    hasMoreBefore,
    loadingMore,
    loadMoreError,
    receiveState,
    receivePatch,
    clear,
    invalidate,
    deny,
    readLoadedHistory,
    loadMore
  };
}

export { createConversationHistory };
