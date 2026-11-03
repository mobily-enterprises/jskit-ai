import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  scrollDistanceFromBottom,
  scrollElementNearBottom
} from "../../shared/conversation/scrollFollowState.js";
import { hasWindowFunction } from "../browser.js";
import { useScrollToBottom } from "./useScrollToBottom.js";

const USER_SCROLL_INTENT_RESET_MS = 600;
const LOAD_MORE_THRESHOLD_PX = 160;
const KEYBOARD_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  "Spacebar"
]);
const UPWARD_SCROLL_KEYS = new Set(["ArrowUp", "Home", "PageUp"]);

function messageScrollKey(message = null) {
  if (!message) {
    return "empty";
  }
  return [
    message.messageId || "",
    message.role || "",
    message.at || "",
    String(message.text || "")
  ].join("/");
}

/**
 * How the transcript follows its latest message: it settles at the end when it opens, keeps following new output
 * while the reader stays at the end, stops as soon as the reader scrolls up, asks for older history near the top and
 * keeps the reader's place when that history arrives or a retained transcript is shown again.
 * @param {{
 *   props: {
 *     error: string,
 *     followLatestKey: number | string,
 *     hasMoreBefore: boolean,
 *     loading: boolean,
 *     loadingMore: boolean,
 *     loadMoreError: string,
 *     retainWhenHidden: boolean,
 *     scrollKey: number | string,
 *     visible: boolean
 *   },
 *   displayEntries: import("vue").ComputedRef<any[]>,
 *   isWorking: import("vue").ComputedRef<boolean>,
 *   bodyElement: import("vue").Ref<HTMLElement | null>,
 *   bottomElement: import("vue").Ref<HTMLElement | null>,
 *   loadMore: (request: { complete: (result?: { changed?: boolean }) => void }) => void
 * }} options The transcript's props, its entries, its scrolled body and end marker, and how it asks for older history.
 */
function useTranscriptScrollFollow({ props, displayEntries, isWorking, bodyElement, bottomElement, loadMore }) {
  const followingLatest = ref(true);
  const initialScrollSettled = ref(false);
  const userScrollIntent = ref(false);
  let liveScrollFrame = 0;
  let userScrollIntentTimer = null;
  let initialScrollVersion = 0;
  let loadMoreScrollSnapshot = null;
  let retainedReaderScrollSnapshot = null;
  let loadMoreRequestVersion = 0;
  let pendingTailFollow = false;
  let previousScrollTop = 0;
  let previousScrollHeight = 0;
  let userScrollIntentUpward = false;
  let lastTouchY = null;

  const loadingIndicatorVisible = computed(() => Boolean(
    props.loading &&
    !displayEntries.value.length
  ));
  const initialScrollPending = computed(() => Boolean(
    props.visible &&
    displayEntries.value.length &&
    !initialScrollSettled.value
  ));

  const timelineScrollTrigger = computed(() => [
    loadingIndicatorVisible.value ? "loading" : "ready",
    displayEntries.value.length ? "has-messages" : "empty",
    props.scrollKey
  ].join(":"));
  const latestRenderedTailKey = computed(() => {
    const entry = displayEntries.value.at(-1);
    if (!entry) return "";
    return [
      entry.key,
      isWorking.value,
      entry.role === "thinking" ? entry.messages.map(messageScrollKey).join("+") : messageScrollKey(entry.message),
      entry.turn.optimistic?.status || "",
      entry.turn.optimistic?.error || ""
    ].join(":");
  });
  const autoScrollEnabled = computed(() => Boolean(
    props.visible &&
    followingLatest.value
  ));

  const {
    clearScheduledScrolls,
    scrollAfterLayout: scrollToLatestMessage,
    scrollNow: scrollToLatestMessageNow
  } = useScrollToBottom({
    anchor: bottomElement,
    enabled: autoScrollEnabled,
    scrollAnchorIntoView: false,
    target: bodyElement
  });

  function clearUserScrollIntent() {
    if (userScrollIntentTimer && hasWindowFunction("clearTimeout")) {
      window.clearTimeout(userScrollIntentTimer);
    }
    userScrollIntentTimer = null;
    userScrollIntent.value = false;
  }

  function resumePendingTailFollow() {
    const shouldResume = pendingTailFollow && followingLatest.value;
    pendingTailFollow = false;
    if (shouldResume) {
      queueLiveBottomScroll();
    }
  }

  function markUserScrollIntent({ upward = false } = {}) {
    retainedReaderScrollSnapshot = null;
    userScrollIntent.value = true;
    userScrollIntentUpward = upward;
    clearLiveBottomScroll();
    clearScheduledScrolls();
    if (userScrollIntentTimer && hasWindowFunction("clearTimeout")) {
      window.clearTimeout(userScrollIntentTimer);
    }
    if (!hasWindowFunction("setTimeout")) {
      return;
    }
    userScrollIntentTimer = window.setTimeout(() => {
      userScrollIntentTimer = null;
      userScrollIntent.value = false;
      resumePendingTailFollow();
    }, USER_SCROLL_INTENT_RESET_MS);
  }

  function markKeyboardScrollIntent(event = {}) {
    if (!KEYBOARD_SCROLL_KEYS.has(String(event.key || "")) || event.defaultPrevented) {
      return;
    }
    const target = event.target;
    const tagName = String(target?.tagName || "").toLowerCase();
    if (
      target?.isContentEditable ||
      ["input", "select", "textarea"].includes(tagName) ||
      ([" ", "Spacebar"].includes(event.key) && ["a", "button"].includes(tagName))
    ) {
      return;
    }
    markUserScrollIntent({
      upward: UPWARD_SCROLL_KEYS.has(event.key) || (event.shiftKey && [" ", "Spacebar"].includes(event.key))
    });
  }

  function rememberTouch(event = {}) {
    lastTouchY = event.touches?.[0]?.clientY ?? null;
  }

  function markTouchScrollIntent(event = {}) {
    const touchY = event.touches?.[0]?.clientY ?? null;
    // A finger moving down the screen scrolls the transcript up.
    markUserScrollIntent({ upward: touchY !== null && lastTouchY !== null && touchY > lastTouchY });
    lastTouchY = touchY;
  }

  function scrollToLatestMessageAfterLayout({
    behavior = "auto",
    force = false
  } = {}) {
    if (force) {
      retainedReaderScrollSnapshot = null;
      followingLatest.value = true;
      clearUserScrollIntent();
    }
    return scrollToLatestMessage({
      behavior
    });
  }

  function queueInitialBottomScroll() {
    const version = initialScrollVersion + 1;
    initialScrollVersion = version;
    initialScrollSettled.value = false;
    if (props.retainWhenHidden && !props.visible) {
      return;
    }
    void scrollToLatestMessageAfterLayout({
      behavior: "auto",
      force: true
    }).finally(() => {
      if (initialScrollVersion === version) {
        initialScrollSettled.value = true;
      }
    });
  }

  function queueLiveBottomScroll({
    force = false
  } = {}) {
    if (userScrollIntent.value && !force) {
      pendingTailFollow = true;
      return;
    }
    if (force) {
      retainedReaderScrollSnapshot = null;
      pendingTailFollow = false;
      followingLatest.value = true;
      clearUserScrollIntent();
    }
    if (props.retainWhenHidden && !props.visible) {
      return;
    }
    if (liveScrollFrame) {
      return;
    }
    if (!hasWindowFunction("requestAnimationFrame")) {
      void scrollToLatestMessageAfterLayout({ behavior: "auto" });
      return;
    }
    liveScrollFrame = window.requestAnimationFrame(() => {
      liveScrollFrame = 0;
      scrollToLatestMessageNow({ behavior: "auto" });
    });
  }

  function clearLiveBottomScroll() {
    if (liveScrollFrame && hasWindowFunction("cancelAnimationFrame")) {
      window.cancelAnimationFrame(liveScrollFrame);
    }
    liveScrollFrame = 0;
  }

  function updateLatestFollowFromScroll(event) {
    if (props.retainWhenHidden && !props.visible) {
      return;
    }
    const target = event?.currentTarget || bodyElement.value;
    if (retainedReaderScrollSnapshot?.restoring) {
      previousScrollTop = target?.scrollTop || 0;
      previousScrollHeight = target?.scrollHeight || 0;
      return;
    }
    const scrollTop = target?.scrollTop || 0;
    const scrollHeight = target?.scrollHeight || 0;
    const scrolledUp = scrollTop < previousScrollTop;
    // Layout changes such as scroll anchoring move scrollTop together with the
    // content height; moving up over unchanged content is the reader's own.
    const readerMovedUp = scrolledUp && scrollHeight === previousScrollHeight;
    previousScrollTop = scrollTop;
    previousScrollHeight = scrollHeight;
    // Keep following the reader while the request is pending, before rows prepend.
    if (loadMoreScrollSnapshot && !loadMoreScrollSnapshot.completed) {
      loadMoreScrollSnapshot.scrollTop = scrollTop;
      loadMoreScrollSnapshot.anchor = visibleHistoryAnchor(target);
      loadMoreScrollSnapshot.scrollHeight = target.scrollHeight;
    }
    // The reader's own upward scrolling leaves the latest message from its first
    // frame, even within the follow threshold.
    const userScrollsUp = userScrollIntent.value && userScrollIntentUpward;
    const shouldFollow = scrollElementNearBottom(target) &&
      !(userScrollsUp && scrollDistanceFromBottom(target) > 1);
    if (!shouldFollow && !userScrollIntent.value && !readerMovedUp && followingLatest.value) {
      return;
    }
    followingLatest.value = shouldFollow;
    if (shouldFollow) {
      // A scroll event still at the end, queued before upward input, must not
      // end that input's intent.
      if (!userScrollsUp) {
        clearUserScrollIntent();
      }
      resumePendingTailFollow();
      return;
    }
    clearLiveBottomScroll();
    clearScheduledScrolls();
    if (
      scrolledUp &&
      initialScrollSettled.value &&
      scrollTop <= LOAD_MORE_THRESHOLD_PX &&
      !props.loadMoreError
    ) {
      requestLoadMore();
    }
  }

  function visibleHistoryAnchor(element) {
    const top = element.getBoundingClientRect().top;
    for (const turn of element.querySelectorAll(".assistant-transcript__turn")) {
      const bounds = turn.getBoundingClientRect();
      if (bounds.bottom > top) {
        return { element: turn, offset: bounds.top - top };
      }
    }
    return null;
  }

  // Offscreen turns use estimated heights. Preserve the visible anchor row instead
  // of moving by the total height difference, which can change during layout.
  function restoreAnchoredScroll(element, snapshot) {
    const anchor = snapshot.anchor;
    if (anchor && element.contains(anchor.element)) {
      // Materialize the anchor row before reading the browser's adjusted scrollTop.
      const offset = anchor.element.getBoundingClientRect().top - element.getBoundingClientRect().top;
      previousScrollTop = element.scrollTop + offset - anchor.offset;
    } else {
      previousScrollTop = snapshot.scrollTop + (element.scrollHeight - snapshot.scrollHeight);
    }
    element.scrollTop = previousScrollTop;
  }

  // Reopening materializes previously hidden content-visibility estimates.
  async function waitForTwoFrames() {
    if (hasWindowFunction("requestAnimationFrame")) {
      await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }
  }

  async function restoreRetainedReaderScroll() {
    const snapshot = retainedReaderScrollSnapshot;
    snapshot.restoring = true;
    await nextTick();
    for (let pass = 0; pass < 2; pass += 1) {
      const element = bodyElement.value;
      if (
        retainedReaderScrollSnapshot !== snapshot ||
        element !== snapshot.body ||
        snapshot.scrollKey !== props.scrollKey ||
        !props.retainWhenHidden ||
        !props.visible ||
        followingLatest.value ||
        loadMoreScrollSnapshot
      ) {
        if (retainedReaderScrollSnapshot === snapshot) retainedReaderScrollSnapshot = null;
        return;
      }
      restoreAnchoredScroll(element, snapshot);
      if (pass === 0) await waitForTwoFrames();
    }
    if (retainedReaderScrollSnapshot === snapshot) retainedReaderScrollSnapshot = null;
  }

  function requestLoadMore() {
    if ((props.retainWhenHidden && !props.visible) || !props.hasMoreBefore || props.loadingMore || loadMoreScrollSnapshot) {
      return;
    }
    followingLatest.value = false;
    pendingTailFollow = false;
    markUserScrollIntent();
    const element = bodyElement.value;
    const version = loadMoreRequestVersion + 1;
    loadMoreRequestVersion = version;
    loadMoreScrollSnapshot = element
      ? {
          anchor: visibleHistoryAnchor(element),
          scrollHeight: element.scrollHeight,
          scrollKey: props.scrollKey,
          scrollTop: element.scrollTop,
          version
        }
      : null;
    loadMore({
      complete: ({ changed = false } = {}) => {
        void completeLoadMoreRequest(version, changed);
      }
    });
  }

  function clearLoadMoreScrollSnapshot() {
    loadMoreRequestVersion += 1;
    loadMoreScrollSnapshot = null;
  }

  async function completeLoadMoreRequest(version, changed) {
    const snapshot = loadMoreScrollSnapshot;
    if (!snapshot || snapshot.version !== version) {
      return;
    }
    if (!changed || snapshot.scrollKey !== props.scrollKey) {
      clearLoadMoreScrollSnapshot();
      return;
    }
    snapshot.completed = true;
    await nextTick();
    if (loadMoreScrollSnapshot?.version !== version) {
      return;
    }
    const passes = props.retainWhenHidden ? 2 : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      if (
        (props.retainWhenHidden && !props.visible) ||
        loadMoreScrollSnapshot?.version !== version ||
        snapshot.scrollKey !== props.scrollKey
      ) {
        return;
      }
      const element = bodyElement.value;
      if (element) restoreAnchoredScroll(element, snapshot);
      if (pass + 1 < passes) await waitForTwoFrames();
    }
    clearLoadMoreScrollSnapshot();
  }

  onBeforeUnmount(() => {
    retainedReaderScrollSnapshot = null;
    clearLiveBottomScroll();
    clearUserScrollIntent();
    clearLoadMoreScrollSnapshot();
  });

  watch(() => [
    timelineScrollTrigger.value,
    latestRenderedTailKey.value
  ], ([timelineKey, value], [previousTimelineKey, previous] = []) => {
    if (timelineKey !== previousTimelineKey) {
      return;
    }
    if (!value || value === previous) {
      return;
    }
    queueLiveBottomScroll({
      force: false
    });
  }, {
    flush: "post"
  });

  watch(() => [
    props.scrollKey,
    props.followLatestKey
  ], ([scrollKey, value], [previousScrollKey, previous] = []) => {
    if (scrollKey !== previousScrollKey || value === previous) {
      return;
    }
    queueLiveBottomScroll({
      force: true
    });
  }, {
    flush: "post"
  });

  watch(timelineScrollTrigger, () => {
    retainedReaderScrollSnapshot = null;
    clearLoadMoreScrollSnapshot();
    queueInitialBottomScroll();
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => props.error, () => {
    if (followingLatest.value) queueLiveBottomScroll();
  }, { flush: "post" });

  // Capture before this transcript or its parent's v-show removes its geometry.
  watch(() => props.visible, (visible) => {
    if (visible) return;
    retainedReaderScrollSnapshot = null;
    const element = bodyElement.value;
    if (
      props.retainWhenHidden &&
      initialScrollSettled.value &&
      !followingLatest.value &&
      !loadMoreScrollSnapshot &&
      element?.clientHeight > 0
    ) {
      retainedReaderScrollSnapshot = {
        anchor: visibleHistoryAnchor(element),
        body: element,
        scrollHeight: element.scrollHeight,
        scrollKey: props.scrollKey,
        scrollTop: element.scrollTop
      };
    }
  }, { flush: "sync" });

  watch(() => props.visible, (visible) => {
    if (props.retainWhenHidden) {
      if (!visible) {
        clearLiveBottomScroll();
        clearScheduledScrolls();
        clearUserScrollIntent();
        initialScrollVersion += 1;
      } else if (loadMoreScrollSnapshot?.completed) {
        void completeLoadMoreRequest(loadMoreScrollSnapshot.version, true);
      } else if (!initialScrollSettled.value) {
        queueInitialBottomScroll();
      } else if (retainedReaderScrollSnapshot) {
        void restoreRetainedReaderScroll();
      } else {
        queueLiveBottomScroll();
      }
      return;
    }
    clearLoadMoreScrollSnapshot();
    if (visible) queueLiveBottomScroll({ force: true });
  }, { flush: "post" });

  return {
    initialScrollPending,
    loadingIndicatorVisible,
    markKeyboardScrollIntent,
    markTouchScrollIntent,
    markUserScrollIntent,
    rememberTouch,
    requestLoadMore,
    updateLatestFollowFromScroll
  };
}

export { useTranscriptScrollFollow };
