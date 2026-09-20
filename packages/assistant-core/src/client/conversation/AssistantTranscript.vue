<template>
  <section
    v-if="visible"
    class="assistant-transcript"
    :class="`assistant-transcript--${variant}`"
    aria-label="Conversation history"
  >
    <v-btn
      v-if="reloadable"
      :aria-label="reloading ? 'Reloading chat' : 'Reload chat'"
      class="assistant-transcript__reload"
      :disabled="reloading"
      :icon="mdiRefresh"
      size="x-small"
      :title="reloading ? 'Reloading chat' : 'Reload chat'"
      type="button"
      variant="text"
      @click="emit('reload')"
    />

    <v-skeleton-loader
      v-if="loadingIndicatorVisible && !reloadable"
      aria-label="Loading conversation"
      class="assistant-transcript__loading-skeleton"
      type="list-item-avatar-two-line@3"
    />

    <div
      v-if="initialScrollPending"
      class="assistant-transcript__settling"
      aria-hidden="true"
    >
      <v-skeleton-loader
        aria-label="Preparing conversation"
        class="assistant-transcript__settling-skeleton"
        type="list-item-avatar-two-line@3"
      />
    </div>

    <v-alert
      v-if="error"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ error }}
    </v-alert>

    <div
      v-else
      ref="bodyElement"
      aria-label="Conversation messages"
      class="assistant-transcript__body"
      :class="{ 'assistant-transcript__body--settling': initialScrollPending }"
      tabindex="0"
      @keydown.capture="markKeyboardScrollIntent"
      @pointerdown.self="markUserScrollIntent"
      @scroll.passive="updateLatestFollowFromScroll"
      @touchmove.passive="markUserScrollIntent"
      @wheel.passive="markUserScrollIntent"
    >
      <div
        v-if="welcomeMessage"
        class="assistant-transcript__welcome"
        role="status"
      >
        <div class="assistant-transcript__assistant-header">
          <span class="assistant-transcript__avatar assistant-transcript__avatar--assistant">
            <v-icon :icon="mdiRobotOutline" size="16" />
          </span>
          <div class="assistant-transcript__message-header">
            <span>{{ assistantLabel }}</span>
          </div>
        </div>
        <slot name="welcome"><p>{{ welcomeMessage }}</p></slot>
      </div>

      <div
        v-if="hasMoreBefore || loadingMore || loadMoreError"
        class="assistant-transcript__load-more"
      >
        <v-btn
          color="primary"
          :disabled="loadingMore || !hasMoreBefore"
          size="x-small"
          type="button"
          variant="tonal"
          @click="requestLoadMore"
        >
          {{ loadingMore ? "Loading older messages…" : "Load older messages" }}
        </v-btn>
        <div
          v-if="loadMoreError"
          class="assistant-transcript__load-more-error"
        >
          {{ loadMoreError }}
        </div>
      </div>

      <article
        v-for="entry in displayEntries"
        :key="entry.key"
        class="assistant-transcript__turn"
      >
        <div
          v-if="entry.role === 'system'"
          class="assistant-transcript__system"
        >
          <v-icon
            class="assistant-transcript__system-icon"
            :icon="mdiInformationOutline"
            size="15"
          />
          <div class="assistant-transcript__system-body">
            <div class="assistant-transcript__system-meta">
              <span>{{ systemLabel }}</span>
              <time v-if="entry.message.displayAt">{{ entry.message.displayAt }}</time>
            </div>
            <slot name="system-message" :message="entry.message"><LongTextPreviewBlocks compact :blocks="entry.message.blocks" @link-click="handleLongTextLinkClick" /></slot>
          </div>
        </div>

        <div
          v-else-if="entry.role === 'user'"
          class="assistant-transcript__message-row assistant-transcript__message-row--user"
        >
          <div class="assistant-transcript__message assistant-transcript__message--user">
            <div
              class="assistant-transcript__user-content"
            >
              <p v-if="userMessageFormat === 'plain'" class="assistant-transcript__plain-user">{{ userMessageExpanded(entry.turn) ? entry.message.text : userMessagePreviewText(entry.message.text) || entry.message.text }}</p>
              <LongTextPreviewBlocks
                v-else
                :blocks="userMessageExpanded(entry.turn) ? entry.message.blocks : (entry.message.previewBlocks || entry.message.blocks)"
                @link-click="handleLongTextLinkClick"
              />
            </div>
            <button
              v-if="userMessageCollapsible(entry.message)"
              :aria-expanded="userMessageExpanded(entry.turn)"
              class="assistant-transcript__user-content-toggle"
              type="button"
              @click="toggleUserMessage(entry.turn)"
            >
              {{ userMessageExpanded(entry.turn) ? "Show less" : "Read more" }}
            </button>
            <slot name="attachments" :items="entry.message.attachments" :message="entry.message"><AssistantMessageAttachments :attachments="entry.message.attachments || []" /></slot>
            <div
              v-if="entry.message.displayAt"
              class="assistant-transcript__message-footer assistant-transcript__message-footer--user"
            >
              <time v-if="entry.message.displayAt">{{ entry.message.displayAt }}</time>
            </div>
            <div
              v-if="entry.turn.optimistic?.status === 'failed'"
              class="assistant-transcript__optimistic-failure"
            >
              <span>{{ entry.turn.optimistic.error || "Message could not be sent." }}</span>
              <div class="assistant-transcript__optimistic-actions">
                <v-btn
                  color="primary"
                  size="x-small"
                  type="button"
                  variant="tonal"
                  @click="emit('resend-turn', entry.turn.optimistic.id)"
                >
                  Resend
                </v-btn>
                <v-btn
                  size="x-small"
                  type="button"
                  variant="text"
                  @click="emit('cancel-turn', entry.turn.optimistic.id)"
                >
                  Cancel
                </v-btn>
                <v-btn
                  size="x-small"
                  type="button"
                  variant="text"
                  @click="emit('edit-turn', entry.turn.optimistic.id)"
                >
                  Edit
                </v-btn>
              </div>
            </div>
          </div>
          <span class="assistant-transcript__avatar assistant-transcript__avatar--user">
            <v-icon :icon="mdiAccountOutline" size="15" />
          </span>
        </div>

        <AssistantProgress
          v-else-if="entry.role === 'thinking'"
          :key="`${scrollKey}:${entry.key}`"
          class="assistant-transcript__thinking"
          :messages="entry.messages"
          :pending="isWorking && entry === displayEntries.at(-1)"
          :preview-limit="progressPreviewLimit"
          :aria-label="`${entry.turn.assistantLabel || assistantLabel} progress`"
        />
        <div
          v-else
          class="assistant-transcript__message-row assistant-transcript__message-row--assistant"
          :data-message-role="entry.role"
        >
          <div class="assistant-transcript__assistant-header">
            <span class="assistant-transcript__avatar assistant-transcript__avatar--assistant">
              <v-icon :icon="mdiRobotOutline" size="16" />
            </span>
            <div class="assistant-transcript__message-header">
              <span :title="entry.message.assistantDetails || entry.turn.assistantDetails || undefined">
                {{ entry.message.assistantLabel || entry.turn.assistantLabel || assistantLabel }}
              </span>
            </div>
          </div>
          <div class="assistant-transcript__message assistant-transcript__message--assistant">
            <LongTextPreviewBlocks
              v-if="entry.message.blocks.length"
              :blocks="entry.message.blocks"
              @link-click="handleLongTextLinkClick"
            />
            <ol
              v-if="entry.message.questions.length"
              class="assistant-transcript__questions"
            >
              <li
                v-for="question in entry.message.questions"
                :key="question.name"
                class="assistant-transcript__question"
              >
                <span class="assistant-transcript__question-number">{{ question.number }}</span>
                <div class="assistant-transcript__question-content">
                  <span class="assistant-transcript__question-text">
                    <LongTextInlineParts
                      :text="question.label"
                      @link-click="handleLongTextLinkClick"
                    />
                  </span>
                  <ul
                    v-if="question.choices.length"
                    class="assistant-transcript__question-choices"
                  >
                    <li v-for="choice in question.choices" :key="choice.value">
                      <LongTextInlineParts
                        :text="choice.label"
                        @link-click="handleLongTextLinkClick"
                      /><span v-if="choice.recommended"> · Recommended</span>
                    </li>
                  </ul>
                </div>
              </li>
            </ol>
            <LongTextPreviewBlocks
              v-if="entry.message.outroBlocks.length"
              :blocks="entry.message.outroBlocks"
              @link-click="handleLongTextLinkClick"
            />
            <slot name="message-actions" :message="entry.message" :turn="entry.turn" />
          </div>
          <div
            v-if="entry.message.displayAt"
            class="assistant-transcript__message-footer assistant-transcript__message-footer--assistant"
          >
            <time>{{ entry.message.displayAt }}</time>
          </div>
        </div>
      </article>

      <div
        ref="bottomElement"
        class="assistant-transcript__bottom"
        aria-hidden="true"
      />
    </div>
  </section>
</template>

<script setup>
import AssistantMessageAttachments from "./AssistantMessageAttachments.vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  mdiAccountOutline,
  mdiInformationOutline,
  mdiRefresh,
  mdiRobotOutline
} from "@mdi/js";
import { useScrollToBottom } from "./useScrollToBottom.js";
import LongTextInlineParts from "./LongTextInlineParts.vue";
import LongTextPreviewBlocks from "./LongTextPreviewBlocks.vue";
import AssistantProgress from "./AssistantProgress.vue";
import { parseNumberedQuestionPrompt } from "../../shared/conversation/numberedQuestionSugar.js";
import { parseLongTextReviewBlocks } from "../../shared/conversation/longTextBlocks.js";
import {
  scrollElementNearBottom
} from "../../shared/conversation/scrollFollowState.js";
import {
  normalizeThinkingMessageText
} from "../../shared/conversation/thinkingText.js";

const props = defineProps({
  systemLabel: { type: String, default: "Status" },
  working: { type: Boolean, default: undefined },
  progressPreviewLimit: { type: Number, default: 2 },
  userMessageFormat: { type: String, default: "formatted", validator: (value) => ["plain", "formatted"].includes(value) },
  assistantLabel: {
    default: "Assistant",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  followLatestKey: {
    default: 0,
    type: [Number, String]
  },
  hasMoreBefore: {
    default: false,
    type: Boolean
  },
  loading: {
    default: false,
    type: Boolean
  },
  loadingMore: {
    default: false,
    type: Boolean
  },
  loadMoreError: {
    default: "",
    type: String
  },
  reloadable: {
    default: false,
    type: Boolean
  },
  reloading: {
    default: false,
    type: Boolean
  },
  scrollKey: {
    default: "",
    type: [Number, String]
  },
  turns: {
    default: () => [],
    type: Array
  },
  variant: {
    default: "main",
    validator: (value) => ["main", "task"].includes(value),
    type: String
  },
  visible: {
    default: true,
    type: Boolean
  },
  welcomeMessage: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["cancel-turn", "edit-turn", "load-more", "link-click", "reload", "resend-turn"]);

const USER_MESSAGE_COLLAPSE_MIN_CHARACTERS = 360;
const USER_MESSAGE_PREVIEW_MAX_CHARACTERS = 280;
const USER_MESSAGE_PREVIEW_MAX_LINES = 4;
const DISPLAY_MESSAGE_CACHE_LIMIT = 500;
const bodyElement = ref(null);
const bottomElement = ref(null);
const expandedUserMessages = ref(new Set());
const isWorking = computed(() => props.working ?? props.turns.some(turn => turn.pending));
const followingLatest = ref(true);
const initialScrollSettled = ref(false);
const userScrollIntent = ref(false);
const displayMessageCache = new Map();
let liveScrollFrame = 0;
let userScrollIntentTimer = null;
let initialScrollVersion = 0;
let loadMoreScrollSnapshot = null;
let loadMoreRequestVersion = 0;
let pendingTailFollow = false;
let previousScrollTop = 0;
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
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit"
});

function displayTime(value = "") {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return timeFormatter.format(date);
}

function userMessagePreviewText(value = "") {
  const text = String(value || "");
  const characters = [...text];
  const lines = text.split(/\r\n?|\n/u);
  if (
    characters.length <= USER_MESSAGE_COLLAPSE_MIN_CHARACTERS &&
    lines.length <= USER_MESSAGE_PREVIEW_MAX_LINES
  ) {
    return "";
  }
  const firstLines = lines.slice(0, USER_MESSAGE_PREVIEW_MAX_LINES).join("\n");
  const preview = [...firstLines]
    .slice(0, USER_MESSAGE_PREVIEW_MAX_CHARACTERS)
    .join("")
    .trimEnd();
  return preview ? `${preview}…` : "";
}

function displayMessage(message = null, {
  allowNumberedQuestions = false,
  preserveParagraphLineBreaks = false,
  previewUserMessage = false
} = {}, cacheKey = "") {
  if (!message) {
    return null;
  }
  const normalizedCacheKey = String(cacheKey || "").trim();
  const cached = normalizedCacheKey ? displayMessageCache.get(normalizedCacheKey) : null;
  if (
    cached &&
    cached.allowNumberedQuestions === allowNumberedQuestions &&
    cached.attachments === message.attachments &&
    cached.at === message.at &&
    cached.messageId === message.messageId &&
    cached.preserveParagraphLineBreaks === preserveParagraphLineBreaks &&
    cached.previewUserMessage === previewUserMessage &&
    cached.role === message.role &&
    cached.text === message.text
  ) {
    return { ...message, ...cached.value };
  }
  const messageText = message.text;
  const questionInput = allowNumberedQuestions
    ? parseNumberedQuestionPrompt(messageText)
    : {
        intro: "",
        outro: "",
        questions: []
      };
  const hasQuestions = questionInput.questions.length > 0;
  const previewText = previewUserMessage ? userMessagePreviewText(message.text) : "";
  const value = {
    blocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.intro : messageText, {
      preserveParagraphLineBreaks
    }),
    outroBlocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.outro : "", {
      preserveParagraphLineBreaks
    }),
    previewBlocks: previewText
      ? parseLongTextReviewBlocks(previewText, { preserveParagraphLineBreaks: true })
      : null,
    questions: hasQuestions ? questionInput.questions : [],
    displayAt: displayTime(message.at)
  };
  if (normalizedCacheKey) {
    if (
      displayMessageCache.size >= DISPLAY_MESSAGE_CACHE_LIMIT &&
      !displayMessageCache.has(normalizedCacheKey)
    ) {
      displayMessageCache.delete(displayMessageCache.keys().next().value);
    }
    displayMessageCache.set(normalizedCacheKey, {
      allowNumberedQuestions,
      attachments: message.attachments,
      at: message.at,
      messageId: message.messageId,
      preserveParagraphLineBreaks,
      previewUserMessage,
      role: message.role,
      text: message.text,
      value
    });
  }
  return { ...message, ...value };
}

function displayThinkingMessage(message = null) {
  if (!message) {
    return null;
  }
  const text = normalizeThinkingMessageText(message.text);
  if (!text) {
    return null;
  }
  return {
    ...message,
    text,
    displayAt: displayTime(message.at)
  };
}

function conversationAgentMessages(turn = {}) {
  if (Array.isArray(turn.messages)) {
    return turn.messages.filter((message) => (
      ["assistant", "commentary", "thinking"].includes(String(message?.role || "").trim())
    ));
  }
  return [
    ...(Array.isArray(turn.thinking) ? turn.thinking : []),
    ...(Array.isArray(turn.commentary) ? turn.commentary : []),
    turn.assistant
  ].filter(Boolean);
}

function conversationMessageKey(message = {}, index = 0) {
  return [
    String(message.messageId || "").trim(),
    String(message.role || "").trim(),
    String(message.at || "").trim(),
    index
  ].join(":");
}

// Storage rows are not visual boundaries. Only an intervening message ends a
// reasoning group, including when history is prepended or execution continues.
const displayEntries = computed(() => {
  const entries = [];
  for (const [index, turn] of props.turns.entries()) {
    const turnId = String(turn.turnId || index + 1);
    const messages = [
      turn.system && { ...turn.system, role: "system" },
      turn.user && { ...turn.user, role: "user" },
      ...conversationAgentMessages(turn)
    ].filter(Boolean);
    for (const [messageIndex, message] of messages.entries()) {
      const role = String(message.role || "").trim();
      const key = `${turnId}:${conversationMessageKey(message, messageIndex)}`;
      const displayed = role === "thinking" ? displayThinkingMessage(message) : displayMessage(message, {
        allowNumberedQuestions: role !== "user" && role !== "system",
        preserveParagraphLineBreaks: role === "user",
        previewUserMessage: role === "user"
      }, key);
      if (!displayed) continue;
      const previous = entries.at(-1);
      if (role === "thinking" && previous?.role === "thinking") {
        previous.messages.push({ ...displayed, key });
      } else {
        entries.push({
          key, role, turn: { ...turn, turnId }, message: displayed,
          ...(role === "thinking" ? { messages: [{ ...displayed, key }] } : {})
        });
      }
    }
  }
  // Anchor a progress group to the following message, or to the transcript end.
  // Appending progress or prepending history then preserves its expansion state.
  for (const [index, entry] of entries.entries()) {
    if (entry.role === "thinking") entry.key = `progress:${entries[index + 1]?.key || "tail"}`;
  }
  return entries;
});

function handleLongTextLinkClick(payload) {
  emit("link-click", payload);
}

function userMessageCollapsible(message = null) {
  return Array.isArray(message?.previewBlocks);
}

function userMessageExpanded(turn = {}) {
  return expandedUserMessages.value.has(String(turn.turnId || ""));
}

function toggleExpandedKey(expandedKeys, key) {
  const next = new Set(expandedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedKeys.value = next;
}

function toggleUserMessage(turn = {}) {
  const key = String(turn.turnId || "");
  if (!key) {
    return;
  }
  toggleExpandedKey(expandedUserMessages, key);
}

const loadingIndicatorVisible = computed(() => Boolean(
  props.loading &&
  !displayEntries.value.length
));
const initialScrollPending = computed(() => Boolean(
  props.visible &&
  displayEntries.value.length &&
  !initialScrollSettled.value
));

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

const timelineScrollTrigger = computed(() => [
  props.visible ? "visible" : "hidden",
  props.error ? "error" : "body",
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
  if (userScrollIntentTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
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

function markUserScrollIntent() {
  userScrollIntent.value = true;
  clearLiveBottomScroll();
  clearScheduledScrolls();
  if (userScrollIntentTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(userScrollIntentTimer);
  }
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
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
  markUserScrollIntent();
}

function scrollToLatestMessageAfterLayout({
  behavior = "auto",
  force = false
} = {}) {
  if (force) {
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
    pendingTailFollow = false;
    followingLatest.value = true;
    clearUserScrollIntent();
  }
  if (liveScrollFrame) {
    return;
  }
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    void scrollToLatestMessageAfterLayout({ behavior: "auto" });
    return;
  }
  liveScrollFrame = window.requestAnimationFrame(() => {
    liveScrollFrame = 0;
    scrollToLatestMessageNow({ behavior: "auto" });
  });
}

function clearLiveBottomScroll() {
  if (
    liveScrollFrame &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(liveScrollFrame);
  }
  liveScrollFrame = 0;
}

function updateLatestFollowFromScroll(event = {}) {
  const target = event?.currentTarget || bodyElement.value;
  const scrollTop = target?.scrollTop || 0;
  const scrolledUp = scrollTop < previousScrollTop;
  previousScrollTop = scrollTop;
  // Keep following the reader while the request is pending, before rows prepend.
  if (loadMoreScrollSnapshot && target.scrollHeight === loadMoreScrollSnapshot.scrollHeight) {
    loadMoreScrollSnapshot.scrollTop = scrollTop;
    loadMoreScrollSnapshot.anchor = visibleHistoryAnchor(target);
  }
  const shouldFollow = scrollElementNearBottom(target);
  if (!shouldFollow && !userScrollIntent.value && followingLatest.value) {
    return;
  }
  followingLatest.value = shouldFollow;
  if (shouldFollow) {
    clearUserScrollIntent();
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

function requestLoadMore() {
  if (!props.hasMoreBefore || props.loadingMore || loadMoreScrollSnapshot) {
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
  emit("load-more", {
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
  await nextTick();
  if (loadMoreScrollSnapshot?.version !== version) {
    return;
  }
  const element = bodyElement.value;
  if (element) {
    // Offscreen turns use estimated heights. Preserve the visible turn instead
    // of moving by the total height difference, which can change during layout.
    const anchor = snapshot.anchor;
    previousScrollTop = anchor && element.contains(anchor.element)
      ? element.scrollTop + anchor.element.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
      : snapshot.scrollTop + (element.scrollHeight - snapshot.scrollHeight);
    element.scrollTop = previousScrollTop;
  }
  clearLoadMoreScrollSnapshot();
}

onBeforeUnmount(() => {
  clearLiveBottomScroll();
  clearUserScrollIntent();
  clearLoadMoreScrollSnapshot();
});

watch(() => props.scrollKey, () => {
  expandedUserMessages.value = new Set();
  displayMessageCache.clear();
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
  clearLoadMoreScrollSnapshot();
  queueInitialBottomScroll();
}, {
  flush: "post",
  immediate: true
});
</script>

<style scoped>
.assistant-transcript__plain-user { white-space: pre-wrap; margin: 0; }
.assistant-transcript {
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: 0.5rem;
  position: relative;
  text-align: left;
}

.assistant-transcript__loading-skeleton {
  inset: 0;
  overflow: hidden;
  position: absolute;
  z-index: 1;
}

.assistant-transcript__settling {
  background: rgb(var(--v-theme-surface));
  inset: 0;
  overflow: hidden;
  padding: 0.5rem;
  position: absolute;
  z-index: 1;
}

.assistant-transcript__settling-skeleton {
  height: 100%;
}

.assistant-transcript__reload {
  color: rgba(var(--v-theme-on-surface), 0.66);
  position: absolute;
  right: 0.38rem;
  top: 0.38rem;
  z-index: 2;
}

.assistant-transcript__body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.15rem;
}

.assistant-transcript__welcome {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 16px;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  flex: 0 0 auto;
  gap: 0.55rem;
  margin: 0.1rem 0.15rem 0;
  padding: 0.8rem 0.9rem 0.9rem;
}

.assistant-transcript__welcome p {
  line-height: 1.48;
  margin: 0;
}

.assistant-transcript__body--settling {
  visibility: hidden;
}

.assistant-transcript__load-more {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.35rem 0 0.55rem;
}

.assistant-transcript__load-more-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.76rem;
  line-height: 1.3;
  text-align: center;
}

.assistant-transcript__load-more + .assistant-transcript__turn,
.assistant-transcript__body > .assistant-transcript__turn:first-child {
  margin-top: auto;
}

.assistant-transcript__turn {
  contain-intrinsic-block-size: auto 12rem;
  content-visibility: auto;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  min-width: 0;
}

.assistant-transcript__message-row {
  align-items: start;
  display: grid;
  gap: 0.65rem;
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
}

.assistant-transcript__message-row--user {
  grid-template-columns: minmax(0, auto) auto;
  justify-self: end;
  max-width: min(28rem, 88%);
  margin-left: auto;
}

.assistant-transcript__message-row--assistant {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  justify-self: start;
  max-width: min(42rem, 94%);
  margin-right: auto;
}

.assistant-transcript__assistant-header {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: 0;
}

.assistant-transcript__message {
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.assistant-transcript__avatar {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  height: 1.5rem;
  justify-content: center;
  width: 1.5rem;
}

.assistant-transcript__avatar--user {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  margin-top: 0.2rem;
}

.assistant-transcript__avatar--assistant {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  margin-top: 0.05rem;
}

.assistant-transcript__message--user {
  background: rgba(var(--v-theme-primary), 0.1);
  border-radius: 16px;
  color: rgb(var(--v-theme-on-surface));
  gap: 0.75rem;
  justify-content: space-between;
  overflow-x: auto;
  padding: 0.75rem 1rem 0.72rem;
  width: fit-content;
}

.assistant-transcript__message--assistant {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  padding: 0;
}

.assistant-transcript--task {
  border-color: rgba(126, 87, 194, 0.32);
}

.assistant-transcript--task .assistant-transcript__avatar--assistant {
  background: #7e57c2;
}

.assistant-transcript--task .assistant-transcript__message--user {
  background: #eee8f8;
  color: #2d2440;
}

.assistant-transcript__thinking {
  justify-self: start;
  margin-left: 2.15rem;
  max-width: min(34rem, 86%);
}

.assistant-transcript__user-content-toggle {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.assistant-transcript__system {
  align-items: start;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.84);
  display: grid;
  gap: 0.45rem;
  grid-template-columns: auto minmax(0, 1fr);
  justify-self: start;
  max-width: min(34rem, 96%);
  min-width: 0;
  padding: 0.1rem 0.15rem;
}

.assistant-transcript__system-icon {
  color: rgba(var(--v-theme-primary), 0.82);
  margin-top: 0.15rem;
}

.assistant-transcript__system-body {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-transcript__system-meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.48);
  display: flex;
  font-size: 0.72rem;
  gap: 0.5rem;
  line-height: 1.15;
}

.assistant-transcript__message-header {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.82);
  display: flex;
  font-size: 0.9rem;
  gap: 0.7rem;
  justify-content: space-between;
  line-height: 1.2;
}

.assistant-transcript__message--assistant .assistant-transcript__message-header {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-weight: 560;
}

.assistant-transcript__message-header span {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-transcript__message-header time {
  color: #6d7888;
  font-weight: 650;
}

.assistant-transcript__message-footer {
  align-items: center;
  color: #9aa6b6;
  display: flex;
  font-size: 0.88rem;
  font-weight: 500;
  gap: 0.65rem;
  line-height: 1.2;
}

.assistant-transcript__message-footer--user {
  justify-content: flex-start;
}

.assistant-transcript__message-footer--assistant {
  justify-content: flex-start;
  margin-top: -0.15rem;
}

.assistant-transcript__optimistic-failure {
  align-items: center;
  color: rgba(var(--v-theme-error), 0.92);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.76rem;
  gap: 0.35rem 0.55rem;
  line-height: 1.25;
}

.assistant-transcript__optimistic-actions {
  align-items: center;
  display: inline-flex;
  gap: 0.25rem;
}

.assistant-transcript__message--assistant :deep(.studio-long-text-review__blocks),
.assistant-transcript__message--user :deep(.studio-long-text-review__blocks) {
  color: inherit;
  font-size: 0.94rem;
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-transcript__message--assistant :deep(.studio-long-text-review__paragraph),
.assistant-transcript__message--user :deep(.studio-long-text-review__paragraph) {
  font-size: 0.94rem;
  margin-block: 0;
}

.assistant-transcript__message--user :deep(.studio-long-text-review__paragraph) {
  white-space: pre-wrap;
}

.assistant-transcript__user-content {
  min-width: 0;
}

.assistant-transcript__user-content-toggle {
  align-self: flex-start;
  font-size: 0.78rem;
  font-weight: 650;
  padding: 0;
}

.assistant-transcript__user-content-toggle:hover,
.assistant-transcript__user-content-toggle:focus-visible {
  text-decoration: underline;
}

.assistant-transcript__message--assistant :deep(.studio-long-text-review__paragraph code),
.assistant-transcript__message--assistant :deep(.studio-long-text-review__list li > code),
.assistant-transcript__message--assistant :deep(.studio-long-text-review__table th > code),
.assistant-transcript__message--assistant :deep(.studio-long-text-review__table td > code),
.assistant-transcript__message--assistant :deep(.studio-long-text-review__details-summary code),
.assistant-transcript__message--user :deep(.studio-long-text-review__paragraph code),
.assistant-transcript__message--user :deep(.studio-long-text-review__list li > code),
.assistant-transcript__message--user :deep(.studio-long-text-review__table th > code),
.assistant-transcript__message--user :deep(.studio-long-text-review__table td > code),
.assistant-transcript__message--user :deep(.studio-long-text-review__details-summary code) {
  background: rgba(var(--v-theme-primary), 0.07);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 3px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  padding: 0.02rem 0.2rem;
}

.assistant-transcript__questions {
  box-sizing: border-box;
  display: grid;
  gap: 0.2rem;
  list-style: none;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  padding: 0;
}

.assistant-transcript__question {
  align-items: start;
  background: rgba(var(--v-theme-surface), 0.62);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 8px;
  box-sizing: border-box;
  display: grid;
  gap: 0.32rem;
  grid-template-columns: auto minmax(0, 1fr);
  max-width: 100%;
  min-width: 0;
  padding: 0.28rem 0.42rem;
}

.assistant-transcript__question-number {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 760;
  height: 1.35rem;
  justify-content: center;
  line-height: 1;
  min-width: 1.35rem;
}

.assistant-transcript__question-text {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.9rem;
  line-height: 1.35;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-transcript__question-content {
  display: block;
  min-width: 0;
}

.assistant-transcript__question-choices {
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline;
  font-size: 0.8rem;
  margin: 0;
  padding: 0;
}

.assistant-transcript__question-choices::before {
  content: " · ";
}

.assistant-transcript__question-choices li {
  display: inline;
  overflow-wrap: anywhere;
}

.assistant-transcript__question-choices li + li::before {
  content: " · ";
}

.assistant-transcript__bottom {
  height: 1px;
}
</style>
