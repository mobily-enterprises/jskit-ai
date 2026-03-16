<template>
  <section
    ref="rootRef"
    :class="rootClasses.concat(['d-flex', 'flex-column', 'h-100', 'ga-1'])"
    :data-testid="uiTestIds.root"
    tabindex="-1"
    @focus="onRootFocus"
    @pointerdown.capture="onRootPointerDown"
  >
    <v-row class="assistant-layout h-100 flex-grow-1 my-0">
      <v-col cols="12" lg="8" class="assistant-main-col d-flex flex-column overflow-hidden">
        <v-card rounded="lg" elevation="1" border class="assistant-main-card d-flex flex-column flex-grow-1">
          <v-card-text class="assistant-main-card-text d-flex flex-column flex-grow-1">
            <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ error }}
            </v-alert>

            <div
              ref="messagesPanelRef"
              class="messages-panel mb-3 flex-grow-1"
              :class="[{ 'messages-panel--empty': messages.length < 1 }, uiClasses.messagesPanel]"
              :data-testid="uiTestIds.messagesPanel"
              @scroll.passive="handleMessagesPanelScroll"
            >
              <div v-if="messages.length < 1" class="messages-empty-state">
                <slot name="empty-state" :state="state" :actions="actions">{{ copyText.emptyState }}</slot>
              </div>
              <div
                v-for="message in messages"
                :key="message.id"
                class="message-row d-flex align-end ga-2 mb-3"
                :class="[`message-row--${message.role}`, { 'flex-row-reverse': message.role === 'user' }]"
              >
                <v-avatar v-if="message.role === 'user'" size="36" class="message-avatar message-avatar--user">
                  <v-img v-if="currentUserAvatarUrl" :src="currentUserAvatarUrl" cover />
                  <span v-else class="message-avatar-initials">{{ currentUserInitials }}</span>
                </v-avatar>
                <v-avatar v-else size="36" class="message-avatar message-avatar--assistant" aria-hidden="true" />
                <div class="message-body d-flex flex-column">
                  <div class="message-meta mb-1 text-caption text-medium-emphasis">
                    <span class="message-author">{{ messageAuthorLabel(message) }}</span>
                  </div>
                  <div class="message-bubble">
                    <div
                      v-if="showAssistantTypingIndicator(message)"
                      class="message-typing d-inline-flex align-center ga-1"
                      aria-label="Assistant is typing"
                    >
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                    </div>
                    <div
                      v-else-if="isAssistantChatMessage(message)"
                      class="message-text message-text--markdown text-body-2"
                      v-html="assistantMessageHtml(message)"
                    />
                    <div v-else class="message-text text-body-2">{{ message.text }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="assistant-composer-shell d-grid" :class="uiClasses.composer">
              <div class="assistant-composer-row d-flex align-end ga-2">
                <v-textarea
                  ref="composerRef"
                  v-model="input"
                  class="assistant-composer-textarea flex-grow-1"
                  :placeholder="copyText.messagePlaceholder"
                  :aria-label="copyText.messagePlaceholder"
                  rows="1"
                  max-rows="4"
                  variant="solo-filled"
                  density="comfortable"
                  auto-grow
                  hide-details="auto"
                  :disabled="isRestoringConversation"
                  @keydown="onHandleInputKeydown"
                />

                <v-btn
                  :color="isStreaming ? 'error' : 'primary'"
                  :class="{ 'assistant-stop-button': isStreaming }"
                  :disabled="isStreaming ? false : !canSend"
                  :data-testid="uiTestIds.sendButton"
                  @click="onSendMessage"
                >
                  {{ isStreaming ? copyText.stop : copyText.send }}
                </v-btn>
              </div>

              <slot name="composer-extra" :state="state" :actions="actions" />

              <div v-if="resolvedFeatures.composerActions" class="assistant-actions d-flex ga-2 flex-wrap mt-2">
                <v-btn
                  v-if="resolvedFeatures.mobilePicker"
                  class="d-lg-none"
                  variant="tonal"
                  :disabled="isStreaming || isRestoringConversation"
                  @click="onConversationPickerOpen"
                >
                  {{ copyText.conversations }}
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4" class="assistant-side-col d-flex flex-column overflow-hidden">
        <v-card
          v-if="resolvedFeatures.historyPanel"
          rounded="lg"
          elevation="1"
          border
          class="d-none d-lg-flex flex-column mb-3 assistant-history-card overflow-hidden"
        >
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.conversationHistory }}</v-card-title>
            <template #append>
              <v-btn
                variant="text"
                size="small"
                :disabled="isStreaming || isRestoringConversation || conversationHistoryLoading"
                @click="refreshConversationHistory"
              >
                {{ copyText.refresh }}
              </v-btn>
            </template>
            <slot name="history-header-extra" :state="state" :actions="actions" />
          </v-card-item>
          <v-divider />
          <v-card-text class="pt-2 assistant-history-card-text d-flex flex-column flex-grow-1">
            <v-btn
              block
              variant="outlined"
              color="primary"
              class="mb-2 assistant-history-start-button"
              :disabled="!canStartNewConversation"
              @click="onStartNewConversation"
            >
              {{ copyText.startNewConversation }}
            </v-btn>
            <div v-if="conversationHistoryError" class="text-caption text-error mb-2">
              {{ conversationHistoryError }}
            </div>
            <v-list density="compact" class="assistant-history-list flex-grow-1 overflow-y-auto">
              <v-list-item v-if="conversationHistory.length < 1" :title="copyText.noConversations" />
              <v-list-item
                v-for="conversation in conversationHistory"
                :key="conversation.id"
                :title="conversationDisplayTitle(conversation)"
                :subtitle="conversationSubtitle(conversation)"
                :active="isActiveConversation(conversation)"
                :disabled="isStreaming || isRestoringConversation"
                @click="onSelectConversation(conversation)"
              />
            </v-list>
          </v-card-text>
        </v-card>

        <v-card
          v-if="resolvedFeatures.toolsPanel"
          rounded="lg"
          elevation="1"
          border
          class="assistant-tools-card d-flex flex-column flex-grow-1 overflow-hidden"
        >
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">{{ copyText.toolTimeline }}</v-card-title>
            <slot name="tools-header-extra" :state="state" :actions="actions" />
          </v-card-item>
          <v-divider />
          <v-list density="compact" class="assistant-tools-list flex-grow-1 overflow-y-auto">
            <v-list-item v-if="pendingToolEvents.length < 1" :title="copyText.noToolEvents" />
            <v-list-item
              v-for="toolEvent in pendingToolEvents"
              :key="toolEvent.id"
              :title="toolEvent.name"
              :subtitle="toolEvent.status"
            />
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <v-bottom-sheet v-if="resolvedFeatures.mobilePicker" v-model="conversationPickerOpen">
      <v-card rounded="t-lg" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">{{ copyText.conversations }}</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-3">
          <v-btn
            block
            variant="outlined"
            color="primary"
            class="mb-2"
            :disabled="!canStartNewConversation"
            @click="startNewConversationFromPicker"
          >
            {{ copyText.startNewConversation }}
          </v-btn>
          <div v-if="conversationHistoryError" class="text-caption text-error mb-2">{{ conversationHistoryError }}</div>
          <v-list density="compact">
            <v-list-item v-if="conversationHistory.length < 1" :title="copyText.noConversations" />
            <v-list-item
              v-for="conversation in conversationHistory"
              :key="conversation.id"
              :title="conversationDisplayTitle(conversation)"
              :subtitle="conversationSubtitle(conversation)"
              :active="isActiveConversation(conversation)"
              :disabled="isStreaming || isRestoringConversation"
              @click="selectConversationFromPicker(conversation)"
            />
          </v-list>
        </v-card-text>
      </v-card>
    </v-bottom-sheet>

    <slot name="footer-extra" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { renderMarkdownToSafeHtml } from "../lib/markdownRenderer.js";

const DEFAULT_COPY = Object.freeze({
  emptyState: "I am here to help",
  assistantLabel: "Assistant",
  systemLabel: "System",
  messagePlaceholder: "Message",
  stop: "STOP",
  send: "Send",
  conversations: "Conversations",
  conversationHistory: "Conversation History",
  refresh: "Refresh",
  startNewConversation: "Start new conversation",
  noConversations: "No conversations yet.",
  unknownConversationTitle: "New conversation",
  unknownUser: "Unknown user",
  unknownDate: "unknown",
  toolTimeline: "Tool Timeline",
  noToolEvents: "No tool events yet."
});

const props = defineProps({
  meta: {
    type: Object,
    required: true
  },
  state: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  },
  viewer: {
    type: Object,
    default: () => ({})
  },
  copy: {
    type: Object,
    default: () => ({})
  },
  variant: {
    type: Object,
    default: () => ({})
  },
  features: {
    type: Object,
    default: () => ({})
  },
  ui: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  "action:started",
  "action:succeeded",
  "action:failed",
  "interaction",
  "conversation:start",
  "conversation:select",
  "message:send",
  "stream:cancel"
]);

const SCROLL_BOTTOM_THRESHOLD_PX = 30;
const MIN_VIEWPORT_HEIGHT_PX = 360;
const VIEWPORT_BOTTOM_GUTTER_PX = 12;
const ROOT_FOCUS_POINTER_GUARD_MS = 200;
const MESSAGE_MARKDOWN_RENDER_THROTTLE_MS = 40;

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

const meta = props.meta;
const state = props.state;
const actions = props.actions;

const messages = state.messages;
const input = state.input;
const isStreaming = state.isStreaming;
const isRestoringConversation = state.isRestoringConversation;
const error = state.error;
const pendingToolEvents = state.pendingToolEvents;
const conversationId = state.conversationId;
const conversationHistory = state.conversationHistory;
const conversationHistoryLoading = state.conversationHistoryLoading;
const conversationHistoryError = state.conversationHistoryError;
const isAdminSurface = state.isAdminSurface;
const canSend = state.canSend;
const canStartNewConversation = state.canStartNewConversation;

const sendMessage = actions.sendMessage;
const handleInputKeydown = actions.handleInputKeydown;
const cancelStream = actions.cancelStream;
const startNewConversation = actions.startNewConversation;
const selectConversation = actions.selectConversation;
const refreshConversationHistory = actions.refreshConversationHistory;

const copyText = computed(() => ({
  ...DEFAULT_COPY,
  ...toRecord(props.copy)
}));

const resolvedVariant = computed(() => {
  const variant = toRecord(props.variant);
  return {
    layout: normalizeVariantValue(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeVariantValue(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeVariantValue(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeVariantValue(variant.tone, ["neutral", "emphasized"], "neutral")
  };
});

const resolvedFeatures = computed(() => {
  const features = toRecord(props.features);
  return {
    historyPanel: features.historyPanel !== false,
    toolsPanel: features.toolsPanel !== false,
    mobilePicker: features.mobilePicker !== false,
    composerActions: features.composerActions !== false
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    root: String(classes.root || "").trim(),
    messagesPanel: String(classes.messagesPanel || "").trim(),
    composer: String(classes.composer || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "assistant-client-element"),
    messagesPanel: String(testIds.messagesPanel || "assistant-messages-panel"),
    sendButton: String(testIds.sendButton || "assistant-send-button")
  };
});

const rootClasses = computed(() => {
  const classes = [
    "assistant-view",
    "assistant-client-element",
    `assistant-client-element--layout-${resolvedVariant.value.layout}`,
    `assistant-client-element--surface-${resolvedVariant.value.surface}`,
    `assistant-client-element--density-${resolvedVariant.value.density}`,
    `assistant-client-element--tone-${resolvedVariant.value.tone}`
  ];
  if (uiClasses.value.root) {
    classes.push(uiClasses.value.root);
  }
  return classes;
});

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    ...payload
  });
}

async function invokeAction(actionName, payload, callback) {
  emit("action:started", {
    action: actionName,
    payload
  });
  try {
    if (typeof callback === "function") {
      await callback();
    }
    emit("action:succeeded", {
      action: actionName,
      payload
    });
  } catch (errorValue) {
    emit("action:failed", {
      action: actionName,
      payload,
      message: String(errorValue?.message || "Action failed")
    });
    throw errorValue;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function formatConversationStartedAt(value) {
  const formatter = meta?.formatConversationStartedAt;
  if (typeof formatter === "function") {
    return formatter(value);
  }
  return copyText.value.unknownDate;
}

function normalizeConversationStatus(value) {
  const normalizer = meta?.normalizeConversationStatus;
  if (typeof normalizer === "function") {
    return normalizer(value);
  }
  return normalizeText(value).toLowerCase() || "unknown";
}

const viewer = computed(() => {
  const source = toRecord(props.viewer);
  return {
    displayName: normalizeText(source.displayName) || "You",
    avatarUrl: normalizeText(source.avatarUrl)
  };
});

const conversationPickerOpen = ref(false);
const rootRef = ref(null);
const messagesPanelRef = ref(null);
const composerRef = ref(null);
const shouldAutoScrollToBottom = ref(true);
const lastRootPointerDownAt = ref(0);
const renderedAssistantMessagesById = shallowRef(Object.freeze({}));

const assistantMarkdownCacheById = new Map();
let markdownRenderTimeoutId = null;

const currentUserScreenName = computed(() => viewer.value.displayName);
const currentUserAvatarUrl = computed(() => viewer.value.avatarUrl);
const currentUserInitials = computed(() => {
  const raw = currentUserScreenName.value || "You";
  const parts = raw
    .split(/\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length < 1) {
    return "Y";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
});

function messageAuthorLabel(message) {
  const role = normalizeText(message?.role).toLowerCase();
  if (role === "user") {
    return currentUserScreenName.value;
  }
  if (role === "assistant") {
    return copyText.value.assistantLabel;
  }

  return copyText.value.systemLabel;
}

function showAssistantTypingIndicator(message) {
  return (
    normalizeText(message?.role).toLowerCase() === "assistant" &&
    normalizeText(message?.status).toLowerCase() === "streaming" &&
    normalizeText(message?.text).length < 1
  );
}

function isAssistantChatMessage(message) {
  return (
    normalizeText(message?.role).toLowerCase() === "assistant" &&
    normalizeText(message?.kind).toLowerCase() === "chat"
  );
}

function renderAssistantMarkdownSnapshot() {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  const nextRenderedById = {};
  const activeMessageIds = new Set();

  for (const message of entries) {
    if (!isAssistantChatMessage(message)) {
      continue;
    }

    const messageId = String(message?.id || "");
    if (!messageId) {
      continue;
    }

    activeMessageIds.add(messageId);
    const text = String(message?.text || "");
    const cached = assistantMarkdownCacheById.get(messageId);
    const cacheKey = text;

    if (cached && cached.cacheKey === cacheKey) {
      nextRenderedById[messageId] = cached.html;
      continue;
    }

    const renderedHtml = renderMarkdownToSafeHtml(text);
    assistantMarkdownCacheById.set(messageId, {
      cacheKey,
      html: renderedHtml
    });
    nextRenderedById[messageId] = renderedHtml;
  }

  for (const [messageId] of assistantMarkdownCacheById) {
    if (!activeMessageIds.has(messageId)) {
      assistantMarkdownCacheById.delete(messageId);
    }
  }

  renderedAssistantMessagesById.value = Object.freeze(nextRenderedById);
}

function scheduleAssistantMarkdownRender({ immediate = false } = {}) {
  if (immediate) {
    if (markdownRenderTimeoutId) {
      clearTimeout(markdownRenderTimeoutId);
      markdownRenderTimeoutId = null;
    }
    renderAssistantMarkdownSnapshot();
    return;
  }

  if (markdownRenderTimeoutId) {
    return;
  }

  markdownRenderTimeoutId = setTimeout(() => {
    markdownRenderTimeoutId = null;
    renderAssistantMarkdownSnapshot();
  }, MESSAGE_MARKDOWN_RENDER_THROTTLE_MS);
}

function assistantMessageHtml(message) {
  const messageId = String(message?.id || "");
  if (!messageId) {
    return "";
  }

  return String(renderedAssistantMessagesById.value[messageId] || "");
}

function resolveConversationActorLabel(conversation) {
  const displayName = normalizeText(conversation?.createdByUserDisplayName);
  if (displayName) {
    return displayName;
  }

  const email = normalizeText(conversation?.createdByUserEmail);
  if (email) {
    return email;
  }

  const userId = Number(conversation?.createdByUserId);
  if (Number.isInteger(userId) && userId > 0) {
    return `User #${userId}`;
  }

  return copyText.value.unknownUser;
}

function conversationSubtitle(conversation) {
  const id = Number(conversation?.id) || 0;
  const status = normalizeConversationStatus(conversation?.status);
  const startedAt = formatConversationStartedAt(conversation?.startedAt);
  const messageCount = Number(conversation?.messageCount || 0);
  const actorSegment = isAdminSurface.value ? ` • ${resolveConversationActorLabel(conversation)}` : "";
  return `#${id} • ${status} • ${startedAt} • ${messageCount} messages${actorSegment}`;
}

function conversationDisplayTitle(conversation) {
  const explicitTitle = normalizeText(conversation?.title);
  if (explicitTitle) {
    return explicitTitle;
  }

  return copyText.value.unknownConversationTitle;
}

function isActiveConversation(conversation) {
  return String(conversation?.id || "") === String(conversationId.value || "");
}

async function onSelectConversation(conversation) {
  const payload = {
    conversationId: String(conversation?.id || "")
  };
  emit("conversation:select", payload);
  emitInteraction("conversation:select", payload);
  await invokeAction("selectConversation", payload, () => selectConversation(conversation));
  await focusComposerWithRetry(true);
}

async function selectConversationFromPicker(conversation) {
  await onSelectConversation(conversation);
  conversationPickerOpen.value = false;
  await focusComposerWithRetry(true);
}

async function onStartNewConversation() {
  emit("conversation:start", {
    source: "history"
  });
  emitInteraction("conversation:start", {
    source: "history"
  });
  await invokeAction("startNewConversation", {}, startNewConversation);
  await focusComposerWithRetry(true);
}

async function startNewConversationFromPicker() {
  await onStartNewConversation();
  conversationPickerOpen.value = false;
  await focusComposerWithRetry(true);
}

async function onSendMessage() {
  if (isStreaming.value) {
    emit("stream:cancel", {
      source: "composer"
    });
    emitInteraction("stream:cancel", {
      source: "composer"
    });
    await invokeAction("cancelStream", {}, cancelStream);
    return;
  }

  const payload = {
    textLength: String(input.value || "").length
  };
  emit("message:send", payload);
  emitInteraction("message:send", payload);
  await invokeAction("sendMessage", payload, sendMessage);
}

function onConversationPickerOpen() {
  conversationPickerOpen.value = true;
  emitInteraction("conversation:picker-open");
}

function onHandleInputKeydown(event) {
  emitInteraction("composer:keydown", {
    key: String(event?.key || "")
  });
  if (typeof handleInputKeydown === "function") {
    handleInputKeydown(event);
  }
}

function resolveComposerTextarea() {
  const composer = composerRef.value;
  if (!composer || !(composer.$el instanceof HTMLElement)) {
    return null;
  }

  const textarea = composer.$el.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return null;
  }

  return textarea;
}

function focusComposer(selectText = false) {
  const composer = composerRef.value;
  if (!composer) {
    return false;
  }

  if (typeof composer.focus === "function") {
    composer.focus();
  }

  const textarea = resolveComposerTextarea();
  if (!textarea || textarea.disabled) {
    return false;
  }

  if (selectText && typeof textarea.select === "function") {
    textarea.select();
  } else if (typeof textarea.focus === "function") {
    textarea.focus();
  }

  return document.activeElement === textarea;
}

async function focusComposerWithRetry(selectText = false) {
  if (focusComposer(selectText)) {
    return;
  }

  await nextTick();
  if (focusComposer(selectText)) {
    return;
  }

  await new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  if (focusComposer(selectText)) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
  focusComposer(selectText);
}

function onRootFocus(event) {
  const rootElement = rootRef.value;
  if (!(rootElement instanceof HTMLElement)) {
    return;
  }
  if (event?.target !== rootElement) {
    return;
  }
  if (Date.now() - Number(lastRootPointerDownAt.value || 0) < ROOT_FOCUS_POINTER_GUARD_MS) {
    return;
  }

  void focusComposerWithRetry(false);
}

function onRootPointerDown() {
  lastRootPointerDownAt.value = Date.now();
}

function normalizeScrollValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function distanceFromBottom(element) {
  if (!element) {
    return Number.POSITIVE_INFINITY;
  }
  const scrollTop = normalizeScrollValue(element.scrollTop);
  const scrollHeight = normalizeScrollValue(element.scrollHeight);
  const clientHeight = normalizeScrollValue(element.clientHeight);
  return Math.max(0, scrollHeight - (scrollTop + clientHeight));
}

function isScrolledToBottom(element) {
  return distanceFromBottom(element) <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function scrollMessagesToBottom({ behavior = "auto" } = {}) {
  const panel = messagesPanelRef.value;
  if (!panel) {
    return;
  }

  if (behavior === "auto") {
    panel.scrollTop = panel.scrollHeight;
    return;
  }

  const targetTop = Math.max(0, normalizeScrollValue(panel.scrollHeight) - normalizeScrollValue(panel.clientHeight));
  panel.scrollTo({
    top: targetTop,
    behavior
  });
}

function handleMessagesPanelScroll() {
  const panel = messagesPanelRef.value;
  if (!panel) {
    shouldAutoScrollToBottom.value = true;
    return;
  }

  shouldAutoScrollToBottom.value = isScrolledToBottom(panel);
}

function syncViewportHeight() {
  if (typeof window === "undefined") {
    return;
  }

  const rootElement = rootRef.value;
  if (!(rootElement instanceof HTMLElement)) {
    return;
  }

  const viewportHeight = Number(window.innerHeight) || 0;
  const topOffset = Math.max(0, Number(rootElement.getBoundingClientRect().top) || 0);
  const targetHeight = Math.max(MIN_VIEWPORT_HEIGHT_PX, Math.floor(viewportHeight - topOffset - VIEWPORT_BOTTOM_GUTTER_PX));

  rootElement.style.setProperty("--assistant-viewport-height", `${targetHeight}px`);
}

const lastMessageSignature = computed(() => {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  const last = entries[entries.length - 1];
  if (!last) {
    return "none";
  }

  return `${entries.length}|${last.id}|${last.role}|${last.kind}|${String(last.text || "").length}|${last.status}`;
});

const assistantMarkdownSignature = computed(() => {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  return entries
    .filter((message) => isAssistantChatMessage(message))
    .map((message) => `${String(message.id || "")}\u0000${String(message.text || "")}`)
    .join("\u0001");
});

watch(
  () => normalizeText(conversationId.value),
  async (nextConversationId, previousConversationId) => {
    if (!nextConversationId || nextConversationId === previousConversationId) {
      return;
    }

    shouldAutoScrollToBottom.value = true;
    await nextTick();
    scrollMessagesToBottom();
    focusComposer(false);
  },
  {
    immediate: true
  }
);

watch(
  assistantMarkdownSignature,
  () => {
    scheduleAssistantMarkdownRender();
  },
  {
    immediate: true
  }
);

watch(
  lastMessageSignature,
  async (_nextSignature, previousSignature) => {
    const entries = Array.isArray(messages.value) ? messages.value : [];
    const last = entries[entries.length - 1];
    if (!last) {
      return;
    }

    await nextTick();
    if (!shouldAutoScrollToBottom.value) {
      return;
    }

    scrollMessagesToBottom({
      behavior: previousSignature && previousSignature !== "none" ? "smooth" : "auto"
    });
  },
  {
    immediate: true
  }
);

watch(
  () => isStreaming.value,
  async (isNowStreaming, wasStreaming) => {
    if (isNowStreaming || !wasStreaming) {
      return;
    }

    await nextTick();
    if (shouldAutoScrollToBottom.value) {
      scrollMessagesToBottom({
        behavior: "smooth"
      });
    }

    await focusComposerWithRetry(true);
  }
);

onMounted(async () => {
  scheduleAssistantMarkdownRender({
    immediate: true
  });
  await nextTick();
  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight, {
    passive: true
  });
  await focusComposerWithRetry(false);
});

onActivated(async () => {
  syncViewportHeight();
  await focusComposerWithRetry(false);
});

watch(
  () => isRestoringConversation.value,
  async (isNowRestoring, wasRestoring) => {
    if (isNowRestoring || !wasRestoring) {
      return;
    }

    await focusComposerWithRetry(false);
  }
);

onBeforeUnmount(() => {
  if (markdownRenderTimeoutId) {
    clearTimeout(markdownRenderTimeoutId);
    markdownRenderTimeoutId = null;
  }

  assistantMarkdownCacheById.clear();
  if (typeof window === "undefined") {
    return;
  }

  window.removeEventListener("resize", syncViewportHeight);
});
</script>

<style scoped>
.assistant-view {
  height: var(--assistant-viewport-height, 100dvh);
  max-height: var(--assistant-viewport-height, 100dvh);
  min-height: 0;
  overflow: hidden;
  padding-block: 0.1rem 0;
}

.assistant-layout {
  min-height: 0;
  overflow: hidden;
}

.assistant-client-element--layout-compact .messages-panel {
  padding: 0.6rem 0.72rem;
}

.assistant-client-element--surface-plain .assistant-main-card,
.assistant-client-element--surface-plain .assistant-history-card,
.assistant-client-element--surface-plain .assistant-tools-card {
  box-shadow: none;
  border-width: 0;
}

.assistant-client-element--density-compact :deep(.v-card-item) {
  padding-block: 0.6rem;
}

.assistant-client-element--tone-emphasized .message-row--user .message-bubble {
  --bubble-bg: rgba(var(--v-theme-primary), 0.22);
}

.assistant-main-col,
.assistant-side-col,
.assistant-main-card,
.assistant-main-card-text,
.assistant-history-card,
.assistant-tools-card,
.assistant-history-card-text,
.assistant-history-list,
.assistant-tools-list {
  min-height: 0;
}

.messages-panel {
  flex: 1 1 auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px;
  padding: 12px;
  min-height: 0;
  overflow: auto;
  background: rgba(var(--v-theme-surface-variant), 0.14);
}

.messages-panel--empty {
  display: grid;
  place-items: center;
}

.messages-empty-state {
  min-height: 240px;
  text-align: center;
  font-size: clamp(1.25rem, 1.2rem + 1vw, 2rem);
  font-weight: 600;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.message-body {
  max-width: min(82%, 700px);
}

.message-row--user .message-body {
  align-items: flex-end;
}

.message-avatar {
  border: 2px solid rgba(var(--v-theme-surface), 0.95);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  flex: 0 0 auto;
}

.message-avatar--assistant {
  background: linear-gradient(180deg, #2f9a45, #1f7a35) !important;
}

.message-avatar-initials {
  color: rgba(var(--v-theme-on-primary), 1);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.message-bubble {
  --bubble-bg: rgba(var(--v-theme-surface), 0.92);
  --bubble-border: rgba(var(--v-theme-on-surface), 0.16);
  background: var(--bubble-bg);
  border: 1px solid var(--bubble-border);
  border-radius: 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  padding: 10px 12px;
  position: relative;
}

.message-row--assistant .message-bubble::after,
.message-row--user .message-bubble::after {
  background: var(--bubble-bg);
  bottom: 11px;
  content: "";
  height: 12px;
  position: absolute;
  width: 12px;
}

.message-row--assistant .message-bubble::after {
  clip-path: polygon(100% 0, 0 50%, 100% 100%);
  left: -10px;
}

.message-row--user .message-bubble {
  --bubble-bg: rgba(var(--v-theme-primary), 0.14);
  --bubble-border: rgba(var(--v-theme-primary), 0.34);
}

.message-row--user .message-bubble::after {
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  right: -10px;
}

.message-author {
  color: rgba(var(--v-theme-on-surface), 0.84);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.message-row--user .message-author {
  color: rgba(var(--v-theme-primary), 1);
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-text--markdown {
  white-space: normal;
}

.message-text--markdown :deep(p),
.message-text--markdown :deep(ul),
.message-text--markdown :deep(ol),
.message-text--markdown :deep(pre),
.message-text--markdown :deep(blockquote),
.message-text--markdown :deep(h1),
.message-text--markdown :deep(h2),
.message-text--markdown :deep(h3),
.message-text--markdown :deep(h4) {
  margin-block: 0 0.6rem;
}

.message-text--markdown :deep(p:last-child),
.message-text--markdown :deep(ul:last-child),
.message-text--markdown :deep(ol:last-child),
.message-text--markdown :deep(pre:last-child),
.message-text--markdown :deep(blockquote:last-child),
.message-text--markdown :deep(h1:last-child),
.message-text--markdown :deep(h2:last-child),
.message-text--markdown :deep(h3:last-child),
.message-text--markdown :deep(h4:last-child) {
  margin-bottom: 0;
}

.message-text--markdown :deep(code) {
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 4px;
  padding: 0.1rem 0.28rem;
}

.message-text--markdown :deep(pre) {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 8px;
  overflow-x: auto;
  padding: 0.6rem 0.72rem;
}

.message-text--markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.message-typing {
  min-height: 20px;
}

.message-typing-dot {
  animation: message-typing-blink 1.1s infinite ease-in-out;
  background: rgba(var(--v-theme-on-surface), 0.62);
  border-radius: 50%;
  display: inline-block;
  height: 7px;
  width: 7px;
}

.message-typing-dot:nth-child(2) {
  animation-delay: 0.16s;
}

.message-typing-dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes message-typing-blink {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

.assistant-composer-shell {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 18px;
  padding: 0.4rem 0.5rem;
  gap: 0.3rem;
  box-shadow: 0 8px 20px rgba(17, 26, 42, 0.05);
}

.assistant-composer-textarea {
  min-width: 0;
}

.assistant-composer-textarea :deep(.v-field) {
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.assistant-composer-textarea :deep(.v-field__outline),
.assistant-composer-textarea :deep(.v-field::before),
.assistant-composer-textarea :deep(.v-field::after) {
  display: none;
}

.assistant-composer-textarea :deep(.v-field__overlay) {
  display: none;
}

.assistant-composer-textarea :deep(.v-field__input) {
  padding-block: 0.5rem 0.46rem;
}

.assistant-composer-textarea :deep(textarea) {
  line-height: 1.45;
}

.assistant-history-start-button {
  flex: 0 0 auto;
}

.assistant-stop-button {
  background-color: #c62828 !important;
  border: 3px solid #ffffff !important;
  border-radius: 0 !important;
  clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  color: #ffffff !important;
  font-weight: 800;
  letter-spacing: 0.08em;
  min-height: 46px;
  min-width: 70px;
  text-transform: uppercase;
}

@media (min-width: 1280px) {
  .assistant-layout {
    flex-wrap: nowrap;
  }

  .assistant-history-card {
    flex: 1 1 auto;
  }

  .assistant-tools-card {
    flex: 0 0 var(--assistant-tools-panel-height, 320px);
    max-height: var(--assistant-tools-panel-height, 320px);
    min-height: var(--assistant-tools-panel-height, 320px);
  }
}
</style>
