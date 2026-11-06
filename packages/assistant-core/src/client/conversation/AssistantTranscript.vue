<template>
  <section
    v-if="visible || retainWhenHidden"
    v-show="visible"
    class="assistant-transcript"
    :class="[`assistant-transcript--${variant}`, { 'assistant-transcript--retained': retainWhenHidden, 'assistant-transcript--error': error }]"
    :aria-label="t('jskit.assistant.transcript.history')"
  >
    <v-btn
      v-if="reloadable"
      :aria-label="reloadLabel"
      class="assistant-transcript__reload"
      :disabled="reloading"
      icon="$refresh"
      size="x-small"
      :title="reloadLabel"
      type="button"
      variant="text"
      @click="emit('reload')"
    />

    <v-skeleton-loader
      v-if="loadingIndicatorVisible && !reloadable"
      :aria-label="t('jskit.assistant.transcript.loading')"
      class="assistant-transcript__loading-skeleton"
      type="list-item-avatar-two-line@3"
    />

    <div
      v-if="initialScrollPending"
      class="assistant-transcript__settling"
      aria-hidden="true"
    >
      <v-skeleton-loader
        :aria-label="t('jskit.assistant.transcript.preparing')"
        class="assistant-transcript__settling-skeleton"
        type="list-item-avatar-two-line@3"
      />
    </div>

    <v-alert
      v-if="error"
      class="assistant-transcript__error"
      :icon="false"
      density="compact"
      type="warning"
      variant="tonal"
    >
      <div class="assistant-transcript__error-content">
        <v-btn
          v-if="errorReloadable && !reloadable" :disabled="reloading" :min-height="32" size="small"
          :aria-label="reloadLabel"
          type="button" variant="text" @click="emit('reload')"
        >
          {{ reloading ? t('jskit.assistant.transcript.reloadingShort') : t('jskit.assistant.transcript.reload') }}
        </v-btn>
        <span>{{ error }}</span>
      </div>
    </v-alert>

    <div
      ref="bodyElement"
      :aria-label="t('jskit.assistant.transcript.messages')"
      class="assistant-transcript__body"
      :class="{ 'assistant-transcript__body--settling': initialScrollPending }"
      tabindex="0"
      @keydown.capture="markKeyboardScrollIntent"
      @pointerdown.self="markUserScrollIntent()"
      @scroll.passive="updateLatestFollowFromScroll"
      @touchstart.passive="rememberTouch"
      @touchmove.passive="markTouchScrollIntent"
      @wheel.passive="markUserScrollIntent({ upward: $event.deltaY < 0 })"
    >
      <div
        v-if="welcomeMessage"
        class="assistant-transcript__welcome"
        role="status"
      >
        <div class="assistant-transcript__assistant-header">
          <span class="assistant-transcript__avatar assistant-transcript__avatar--assistant">
            <v-icon icon="$smartToy" size="16" />
          </span>
          <div class="assistant-transcript__message-header">
            <span>{{ assistantName }}</span>
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
          {{ loadingMore ? t("jskit.assistant.transcript.loadingOlder") : t("jskit.assistant.transcript.loadOlder") }}
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
            icon="$info"
            size="15"
          />
          <div class="assistant-transcript__system-body">
            <div class="assistant-transcript__system-meta">
              <span>{{ systemName }}</span>
              <time v-if="entry.message.displayAt">{{ entry.message.displayAt }}</time>
            </div>
            <slot name="system-message" :message="entry.message">
              <AssistantConversationStatus :message="entry.message" @check-delivery="emit('check-delivery', $event)" @link-click="handleLongTextLinkClick" />
            </slot>
          </div>
        </div>

        <div
          v-else-if="entry.role === 'user'"
          class="assistant-transcript__message-row assistant-transcript__message-row--user"
        >
          <div
            class="assistant-transcript__message assistant-transcript__message--user"
            :class="{
              'assistant-transcript__message--pending': entry.turn.optimistic?.status === 'pending',
              'assistant-transcript__message--failed': entry.turn.optimistic?.status === 'failed'
            }"
          >
            <div
              class="assistant-transcript__user-content"
            >
              <v-textarea
                v-if="entry.turn.preview && previewForTurn(entry.turn)?.actions?.editing"
                class="assistant-transcript__preview-editor" :model-value="previewForTurn(entry.turn).text" :label="t('jskit.assistant.transcript.reviewMessage')"
                :disabled="!previewForTurn(entry.turn).actions.canEdit" density="compact" :rows="1" :max-rows="2"
                auto-grow hide-details @update:model-value="previewForTurn(entry.turn).actions.update(entry.turn.turnId, $event)"
              />
              <p v-else-if="userMessageFormat === 'plain'" class="assistant-transcript__plain-user">{{ userMessageExpanded(entry.turn) ? entry.message.text : userMessagePreviewText(entry.message.text) || entry.message.text }}</p>
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
              {{ userMessageExpanded(entry.turn) ? t("jskit.assistant.transcript.showLess") : t("jskit.assistant.transcript.readMore") }}
            </button>
            <slot name="attachments" :items="entry.message.attachments" :message="entry.message"><AssistantMessageAttachments :attachments="entry.message.attachments || []" /></slot>
            <div
              v-if="entry.message.displayAt || entry.turn.optimistic?.status === 'pending'"
              class="assistant-transcript__message-footer assistant-transcript__message-footer--user"
            >
              <time v-if="entry.message.displayAt">{{ entry.message.displayAt }}</time>
              <span v-if="entry.turn.optimistic?.status === 'pending'" role="status">{{ entry.turn.optimistic.waiting ? t("jskit.assistant.transcript.pendingReason", { reason: entry.turn.optimistic.waiting }) : t("jskit.assistant.transcript.pending") }}</span>
            </div>
            <slot name="user-message-actions" :message="entry.message" :turn="entry.turn" />
            <div
              v-if="entry.delivery || entry.turn.optimistic?.status === 'failed' || cancelRequested(entry.turn)"
              class="assistant-transcript__optimistic-failure"
            >
              <span role="status">{{ entry.turn.optimistic?.cancelling ? t('jskit.assistant.delivery.cancelling')
                : entry.turn.optimistic?.cancelError ? entry.turn.optimistic.cancelError
                  : entry.delivery ? entry.delivery.delivery.error || t('jskit.assistant.delivery.unconfirmedShort') : t('jskit.assistant.transcript.failed', { error: entry.turn.optimistic.error || t('jskit.assistant.delivery.notSent') }) }}</span>
              <div v-if="!entry.turn.preview" class="assistant-transcript__optimistic-actions">
                <v-btn
                  v-if="!cancelRequested(entry.turn) && (entry.delivery || entry.turn.optimistic?.status === 'failed')"
                  class="assistant-transcript__delivery-action"
                  color="error"
                  size="x-small"
                  type="button"
                  variant="text"
                  :disabled="entry.delivery?.delivery.checking"
                  :aria-label="entry.delivery ? t('jskit.assistant.delivery.retryCheck') : undefined"
                  :title="entry.delivery ? entry.delivery.delivery.error || t('jskit.assistant.delivery.checkBeforeResend') : undefined"
                  @click="entry.delivery ? emit('check-delivery', entry.delivery.delivery.messageId) : emit('resend-turn', entry.turn.optimistic.id)"
                >
                  {{ entry.delivery?.delivery.checking ? t('jskit.assistant.delivery.checking') : t('jskit.assistant.delivery.retry') }}
                </v-btn>
                <v-btn
                  v-if="!entry.delivery || cancellableDelivery || cancelRequested(entry.turn)"
                  class="assistant-transcript__delivery-action"
                  size="x-small"
                  type="button"
                  variant="text"
                  @click="emit('cancel-turn', entry.delivery?.delivery.messageId || entry.turn.optimistic.id)"
                >
                  {{ t("jskit.assistant.transcript.cancel") }}
                </v-btn>
                <v-btn
                  v-if="!entry.delivery && entry.turn.optimistic?.status === 'failed' && !cancelRequested(entry.turn)"
                  class="assistant-transcript__delivery-action"
                  size="x-small"
                  type="button"
                  variant="text"
                  @click="emit('edit-turn', entry.turn.optimistic.id)"
                >
                  {{ t("jskit.assistant.transcript.edit") }}
                </v-btn>
              </div>
            </div>
          </div>
          <span class="assistant-transcript__avatar assistant-transcript__avatar--user">
            <v-icon icon="$person" size="15" />
          </span>
        </div>

        <AssistantProgress
          v-else-if="entry.role === 'thinking'"
          :key="`${scrollKey}:${entry.key}`"
          class="assistant-transcript__thinking"
          :messages="entry.messages"
          :pending="isWorking && entry === displayEntries.at(-1)"
          :preview-limit="progressPreviewLimit"
          :aria-label="t('jskit.assistant.transcript.progress', { name: entry.turn.assistantLabel || assistantName })"
        />
        <div
          v-else
          class="assistant-transcript__message-row assistant-transcript__message-row--assistant"
          :data-message-role="entry.role"
        >
          <div class="assistant-transcript__assistant-header">
            <span class="assistant-transcript__avatar assistant-transcript__avatar--assistant">
              <v-icon icon="$smartToy" size="16" />
            </span>
            <div class="assistant-transcript__message-header">
              <span :title="entry.message.assistantDetails || entry.turn.assistantDetails || undefined">
                {{ entry.message.assistantLabel || entry.turn.assistantLabel || assistantName }}
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
                      /><span v-if="choice.recommended">{{ t("jskit.assistant.transcript.recommended") }}</span>
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
import AssistantConversationStatus from "./AssistantConversationStatus.vue";
import { computed, ref, watch } from "vue";
import LongTextInlineParts from "./LongTextInlineParts.vue";
import LongTextPreviewBlocks from "./LongTextPreviewBlocks.vue";
import AssistantProgress from "./AssistantProgress.vue";
import { useTranscriptEntries, userMessagePreviewText } from "./transcriptEntries.js";
import { useTranscriptScrollFollow } from "./useTranscriptScrollFollow.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

function previewForTurn(turn) {
  const preview = turn.previewMessage || props.previewMessage;
  return (preview?.messageId || preview?.id) === turn.turnId ? preview : null;
}

const props = defineProps({
  cancellableDelivery: { type: Boolean, default: false },
  systemLabel: { type: String, default: undefined },
  previewMessage: { type: Object, default: null },
  working: { type: Boolean, default: undefined },
  progressPreviewLimit: { type: Number, default: 2 },
  userMessageFormat: { type: String, default: "formatted", validator: (value) => ["plain", "formatted"].includes(value) },
  assistantLabel: {
    default: undefined,
    type: String
  },
  error: {
    default: "",
    type: String
  },
  errorReloadable: {
    default: false,
    type: Boolean
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
  retainWhenHidden: {
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

const emit = defineEmits(["cancel-turn", "check-delivery", "edit-turn", "load-more", "link-click", "reload", "resend-turn"]);
const systemName = computed(() => props.systemLabel ?? t("jskit.assistant.transcript.status"));
const assistantName = computed(() => props.assistantLabel ?? t("jskit.assistant.transcript.assistant"));
const reloadLabel = computed(() => props.reloading ? t("jskit.assistant.transcript.reloading") : t("jskit.assistant.transcript.reload"));

const bodyElement = ref(null);
const bottomElement = ref(null);
const expandedUserMessages = ref(new Set());
const isWorking = computed(() => props.working ?? props.turns.some(turn => turn.pending));
const { clearDisplayCache, displayEntries } = useTranscriptEntries(props);

function handleLongTextLinkClick(payload) {
  emit("link-click", payload);
}

// Cancel was pressed and the server has not yet agreed: it is in progress or
// could not reach the server.
function cancelRequested(turn = {}) {
  return Boolean(turn.optimistic?.cancelling || turn.optimistic?.cancelError);
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

// Created before the scroll-following watchers, so a new conversation's expansion and cache reset run first.
watch(() => props.scrollKey, () => {
  expandedUserMessages.value = new Set();
  clearDisplayCache();
});

const {
  initialScrollPending,
  loadingIndicatorVisible,
  markKeyboardScrollIntent,
  markTouchScrollIntent,
  markUserScrollIntent,
  rememberTouch,
  requestLoadMore,
  updateLatestFollowFromScroll
} = useTranscriptScrollFollow({
  props,
  displayEntries,
  isWorking,
  bodyElement,
  bottomElement,
  loadMore: (request) => emit("load-more", request)
});

</script>

<style scoped src="./AssistantTranscript.css"></style>
