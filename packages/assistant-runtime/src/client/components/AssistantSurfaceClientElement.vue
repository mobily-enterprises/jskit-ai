<script setup>
import { computed, onMounted, onScopeDispose, reactive, ref, toRef, watch, watchPostEffect } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantRuntime } from "../composables/useAssistantRuntime.js";
import { mapAssistantConversationTurns, toolStatusText } from "../support/assistantRuntimeState.js";
import { DEFAULT_CONVERSATION_TITLE } from "../../shared/assistantRuntimeConfig.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  surfaceId: { type: String, required: true },
  layout: { type: String, default: "page", validator: (value) => ["page", "compact"].includes(value) },
  // Unset texts follow the active language; an application's own text is shown as given.
  assistantLabel: { type: String, default: undefined },
  welcomeMessage: { type: String, default: undefined },
  placeholder: { type: String, default: undefined },
  showToolActivity: { type: Boolean, default: true },
  connections: { type: Array, default: () => [] },
  attachments: { type: Object, default: null },
  suggestions: { type: Object, default: null },
  goal: { type: Object, default: null },
  activity: { type: Object, default: undefined },
  configurationMode: { type: String, default: "editable", validator: value => ["hidden", "readonly", "editable"].includes(value) }
});
const integrationId = defineModel("integrationId", { type: String, default: "" });
const { t } = useJskitText();
const assistantLabelText = computed(() => props.assistantLabel ?? t("jskit.assistant.runtime.conversation.assistantLabel"));
const draftIntegrationId = ref(integrationId.value);
watch(integrationId, value => { draftIntegrationId.value = value; });
const runtime = useAssistantRuntime({ surfaceId: toRef(props, "surfaceId"), integrationId });
const state = reactive(runtime.state);
const conversation = ref(null);
const root = ref(null);
const historyOpen = ref(false);
// Page mode owns viewport sizing; compact mode fills the host's bounded pane.
onMounted(() => {
  const syncPageOffset = () => {
    if (props.layout === "page") root.value.style.setProperty("--assistant-page-top", `${Math.max(0, root.value.getBoundingClientRect().top)}px`);
  };
  const observer = new ResizeObserver(syncPageOffset);
  observer.observe(root.value.parentElement);
  window.addEventListener("resize", syncPageOffset);
  watchPostEffect(syncPageOffset);
  onScopeDispose(() => {
    observer.disconnect();
    window.removeEventListener("resize", syncPageOffset);
  });
});
const selectedConversation = computed(() => state.conversationHistory.find((entry) => String(entry.id) === state.activeConversationId));
const turns = computed(() => mapAssistantConversationTurns(state.messages, state.pendingToolEvents, props));
const adapter = computed(() => ({
  delivery: runtime.delivery,
  attachments: props.attachments,
  suggestions: props.suggestions,
  goal: props.goal,
  activity: props.activity,
  models: props.connections.length && props.configurationMode !== "hidden" ? {
    providerRows: [{ id: "application", label: t("jskit.assistant.runtime.connection.applicationAi") }],
    modelProviderId: "application", modelRows: props.connections, modelId: draftIntegrationId.value,
    selectionSummary: props.connections.find(connection => connection.id === integrationId.value)?.label ||
      t("jskit.assistant.runtime.connection.applicationDefault"),
    changesDisabled: props.configurationMode !== "editable" || state.isStreaming,
    canSave: props.configurationMode === "editable" && !state.isStreaming && draftIntegrationId.value !== integrationId.value &&
      props.connections.some(connection => connection.id === draftIntegrationId.value),
    selectModel(value) { draftIntegrationId.value = value; },
    apply() { integrationId.value = draftIntegrationId.value; }
  } : null,
  conversation: {
    turns: turns.value,
    scrollKey: `${state.scopeKey}:${state.activeConversationId || "new"}`,
    loading: state.isRestoringConversation,
    working: state.isStreaming && !runtime.delivery.state.sending,
    assistantLabel: assistantLabelText.value,
    welcomeMessage: state.messages.length || state.isRestoringConversation ? ""
      : props.welcomeMessage ?? t("jskit.assistant.runtime.conversation.welcomeMessage")
  },
  composer: {
    draft: state.input,
    canSend: state.canSend || Boolean(props.attachments?.enabled !== false && props.attachments?.attachments?.length &&
      !state.isStreaming && !state.isRestoringConversation && state.hasRuntimeScope),
    disabled: !state.hasRuntimeScope,
    canStop: state.isStreaming,
    stopPending: state.isCanceling,
    placeholder: props.placeholder ?? t("jskit.assistant.runtime.conversation.placeholder"),
    rows: 2,
    density: props.layout === "compact" ? "compact" : "default",
    submitOnEnter: true,
    submitOnModifierEnter: true
  },
  actions: {
    setDraft(value) { state.input = value; },
    submit: ({ attachments }) => submitMessage({ attachments }),
    resend: (messageId) => submitMessage({ retryMessageId: messageId }),
    stop: runtime.actions.cancelStream
  }
}));

function submitMessage({ attachments = [], retryMessageId = "" }) {
  const attachmentOwner = props.attachments;
  const acceptedFiles = retryMessageId ? runtime.delivery.find(retryMessageId)?.payload.displayAttachments || [] : attachments;
  return runtime.actions.sendMessage({
    attachments,
    retryMessageId,
    onAccepted: () => attachmentOwner?.clearAttachments({ accepted: true, attachmentIds: acceptedFiles.map(file => file.attachmentId) })
  });
}

const CONVERSATION_STATUS_KEY = "jskit.assistant.runtime.conversation.status.";

// The saved default title is stored in English; show it in the active language.
function conversationTitle(entry, fallbackKey) {
  if (entry?.title === DEFAULT_CONVERSATION_TITLE) return t("jskit.assistant.runtime.surface.newConversation");
  return entry?.title || t(fallbackKey);
}

function conversationSubtitle(entry) {
  return [t(CONVERSATION_STATUS_KEY + runtime.meta.normalizeConversationStatus(entry.status)),
    runtime.meta.formatConversationStartedAt(entry.startedAt),
    t("jskit.assistant.runtime.surface.messageCount", { count: Number(entry.messageCount || 0) })].join(" · ");
}

async function selectConversation(entry) {
  historyOpen.value = false;
  await runtime.actions.selectConversation(entry);
}

function startNewConversation() {
  runtime.actions.startNewConversation();
  historyOpen.value = false;
}

defineExpose({ focus: () => conversation.value?.focus() });
</script>

<template>
  <section ref="root" class="assistant-surface" :class="`assistant-surface--${layout}`" :aria-label="assistantLabelText">
    <div class="assistant-surface__toolbar">
      <span class="assistant-surface__title">{{ conversationTitle(selectedConversation, "jskit.assistant.runtime.surface.newConversation") }}</span>
      <v-btn variant="text" @click="historyOpen = true">{{ t("jskit.assistant.runtime.surface.conversations") }}</v-btn>
      <v-menu v-if="showToolActivity && state.pendingToolEvents.length" location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text">{{ t("jskit.assistant.runtime.surface.activity") }}</v-btn>
        </template>
        <v-list :aria-label="t('jskit.assistant.runtime.surface.toolActivity')" max-height="320" max-width="360" class="assistant-surface__activity">
          <v-list-item v-for="event in state.pendingToolEvents" :key="event.id" :title="event.name" :subtitle="toolStatusText(event.status)" />
        </v-list>
      </v-menu>
    </div>
    <AssistantConversationElement ref="conversation" :adapter="adapter" :label="t('jskit.assistant.runtime.surface.conversation')" class="assistant-surface__conversation">
      <template v-if="$slots.activity" #activity="scope"><slot name="activity" v-bind="scope" /></template>
      <template v-if="$slots.attachments" #attachments="scope"><slot name="attachments" v-bind="scope" /></template>
      <template #message-actions="{ message }">
        <p v-if="message.status === 'failed' && message.error" class="assistant-surface__message-error" role="status">{{ message.error }}</p>
        <p v-if="message.status === 'interrupted'" class="assistant-surface__notice" role="status">{{ t("jskit.assistant.runtime.surface.responseCanceled") }}</p>
      </template>
      <template #composer-feedback>
        <p v-if="state.error && !state.messages.some((message) => message.error === state.error)" class="assistant-surface__message-error" role="status">{{ state.error }}</p>
      </template>
      <template #composer-tools><slot name="composer-tools" :runtime="runtime" /></template>
    </AssistantConversationElement>

    <v-dialog v-model="historyOpen" max-width="640" scrollable :aria-label="t('jskit.assistant.runtime.surface.conversations')">
      <v-card class="assistant-surface__history">
        <v-card-title>{{ t("jskit.assistant.runtime.surface.conversations") }}</v-card-title>
        <v-card-actions class="assistant-surface__history-actions">
          <v-btn color="primary" :disabled="!state.canStartNewConversation" @click="startNewConversation">
            {{ t("jskit.assistant.runtime.surface.startNewConversation") }}
          </v-btn>
          <v-btn :disabled="state.conversationHistoryLoading" @click="runtime.actions.refreshConversationHistory">
            {{ t("jskit.assistant.runtime.surface.refresh") }}
          </v-btn>
          <v-btn @click="historyOpen = false">{{ t("jskit.assistant.runtime.surface.close") }}</v-btn>
        </v-card-actions>
        <v-card-text>
          <p v-if="state.conversationHistoryError" role="alert">{{ state.conversationHistoryError }}</p>
          <v-skeleton-loader
            v-if="state.conversationHistoryLoading && !state.conversationHistory.length" type="list-item-two-line@3"
            :aria-label="t('jskit.assistant.runtime.surface.loadingConversationsLabel')"
          />
          <v-list v-else :aria-label="t('jskit.assistant.runtime.surface.savedConversations')">
            <v-list-item v-if="!state.conversationHistory.length" :title="t('jskit.assistant.runtime.surface.noSavedConversations')" />
            <v-list-item
              v-for="entry in state.conversationHistory" :key="entry.id"
              :active="String(entry.id) === state.activeConversationId"
              :title="conversationTitle(entry, 'jskit.assistant.runtime.surface.untitledConversation')" :subtitle="conversationSubtitle(entry)"
              :disabled="state.isStreaming || state.isRestoringConversation" @click="selectConversation(entry)"
            />
          </v-list>
          <v-btn v-if="state.conversationHistoryHasMore" :disabled="state.conversationHistoryLoadingMore" variant="text" @click="runtime.actions.loadMoreConversationHistory">
            {{ t(state.conversationHistoryLoadingMore ? "jskit.assistant.runtime.surface.loadingConversations" : "jskit.assistant.runtime.surface.loadOlderConversations") }}
          </v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.assistant-surface { display: flex; flex-direction: column; height: 100%; max-height: 100%; min-height: 0; min-width: 0; overflow: hidden; gap: .5rem; }
.assistant-surface--page { padding: .5rem; height: calc(100dvh - var(--assistant-page-top, 0px) - var(--v-layout-bottom, 0px) - 1rem - env(safe-area-inset-bottom, 0px)); }
.assistant-surface__toolbar { display: flex; align-items: center; flex-wrap: wrap; flex: 0 0 auto; gap: .25rem; }
.assistant-surface__title { flex: 1 1 8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; }
.assistant-surface__conversation { flex: 1 1 auto; }
.assistant-surface__activity { overflow: auto; }
.assistant-surface__message-error, .assistant-surface__notice { font-size: .85rem; margin: .25rem 0; overflow-wrap: anywhere; }
.assistant-surface__message-error { color: rgb(var(--v-theme-error)); }
.assistant-surface__notice { color: rgba(var(--v-theme-on-surface), .75); }
.assistant-surface__history-actions { flex-wrap: wrap; }
@media (max-width: 600px), (pointer: coarse) {
  .assistant-surface__toolbar .v-btn, .assistant-surface__history .v-btn { min-height: 48px; }
}
</style>
