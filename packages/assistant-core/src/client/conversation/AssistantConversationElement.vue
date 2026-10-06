<template>
  <section ref="container" class="assistant-conversation" :aria-label="label">
    <section
      v-if="$slots.avatar" class="assistant-conversation__avatar"
      :class="{ 'assistant-conversation__avatar--hidden': avatarSize === 'hidden' }" aria-label="Conversation avatar"
    >
      <div v-show="avatarSize === 'hidden'" ref="avatarControls" class="assistant-conversation__avatar-controls">
        <slot name="avatar-control" :size="avatarSize" :height="avatarHeight" />
        <v-btn
          :icon="mdiAccountCircleOutline" size="small"
          variant="text" :width="44" :min-width="44" :min-height="44"
          class="assistant-conversation__avatar-size"
          aria-label="Show avatar" title="Show avatar"
          :aria-expanded="avatarSize !== 'hidden'" @click="toggleAvatar"
        >
          <span class="assistant-conversation__avatar-size-disc">
            <v-icon size="20" :icon="mdiAccountCircleOutline" />
          </span>
        </v-btn>
      </div>
      <div v-show="avatarSize !== 'hidden'" class="assistant-conversation__avatar-presentation">
        <div v-if="avatarSize !== 'hidden'" class="assistant-conversation__avatar-visual" :style="{ height: `${avatarHeight}px`, width: `${avatarHeight}px` }">
          <slot name="avatar" :size="avatarSize" :height="avatarHeight" />
        </div>
        <div class="assistant-conversation__avatar-tools">
          <slot name="avatar-tools" :size="avatarSize" :height="avatarHeight" />
          <v-btn
            :icon="mdiMinus" size="small" variant="text" color="primary"
            :width="40" :min-width="40" :min-height="44" class="assistant-conversation__avatar-size"
            aria-label="Minimise avatar" title="Minimise avatar" :aria-expanded="true"
            @click="toggleAvatar"
          >
            <span class="assistant-conversation__avatar-size-disc assistant-conversation__avatar-size-disc--minimise">
              <v-icon size="20" :icon="mdiMinus" />
            </span>
          </v-btn>
        </div>
      </div>
    </section>
    <AssistantTranscript
      v-bind="conversation" :preview-message="adapter.conversation.previewMessage || null" :working="working" class="assistant-conversation__transcript"
      @load-more="adapter.actions?.loadMore?.($event)" @reload="adapter.actions?.reload?.()"
      @resend-turn="resend($event)" @cancel-turn="cancel($event)"
      @check-delivery="adapter.actions?.checkDelivery?.($event)"
      @edit-turn="edit($event)" @link-click="adapter.actions?.openLink?.($event)"
    >
      <template v-for="name in transcriptSlots" #[name]="scope"><slot :name="name" v-bind="scope" /></template>
      <template #user-message-actions="scope">
        <div v-if="scope.turn.preview && scope.turn.previewMessage?.actions" class="assistant-conversation__preview-actions">
          <v-btn
            v-if="scope.turn.previewMessage.actions.discard" :icon="mdiClose" size="small" variant="text"
            aria-label="Discard unsent message" title="Discard unsent message"
            :disabled="!scope.turn.previewMessage.actions.canDiscard"
            @click="scope.turn.previewMessage.actions.discard(scope.turn.turnId)"
          />
          <v-btn
            v-if="scope.turn.previewMessage.actions.edit" :icon="mdiPencil" size="small" variant="text"
            aria-label="Edit unsent message" title="Edit unsent message"
            :disabled="!scope.turn.previewMessage.actions.canEdit"
            @click="scope.turn.previewMessage.actions.edit(scope.turn.turnId)"
          />
          <v-btn
            v-if="scope.turn.previewMessage.actions.send" size="small" color="primary"
            :disabled="!scope.turn.previewMessage.actions.canSend"
            @click="scope.turn.previewMessage.actions.send(scope.turn.turnId)"
          >
            {{ scope.turn.previewMessage.actions.sending ? 'Sending…' : 'Send' }}
          </v-btn>
        </div>
        <slot name="user-message-actions" v-bind="scope" />
      </template>
    </AssistantTranscript>
    <div v-if="adapter.goal && adapter.goal.enabled !== false" class="assistant-conversation__goal">
      <AssistantGoalControl :state="adapter.goal" />
    </div>
    <AssistantComposerSupport
      v-if="!$slots.hints && (adapter.composer || activity.label || adapter.suggestions)"
      :activity="activity" :status-id="statusId"
      :loading="adapter.suggestions?.visible && adapter.suggestions.loading"
      :suggestions="adapter.suggestions?.visible ? adapter.suggestions.items : []"
      @preview="adapter.suggestions?.previewSuggestion($event)"
      @select="selectSuggestion" @dismiss="dismissSuggestions"
    >
      <template v-if="$slots.activity" #activity="scope"><slot name="activity" v-bind="scope" /></template>
    </AssistantComposerSupport>
    <slot name="hints" :adapter="adapter" />
    <slot name="composer" :adapter="adapter">
      <AssistantPromptInput
        v-if="adapter.composer" ref="input" v-bind="adapter.composer" class="assistant-conversation__composer"
        :model-value="adapter.composer.draft || ''" :submit-enabled="canSend"
        :aria-label="adapter.composer.ariaLabel || 'Message AI assistant'" :rows="adapter.composer.rows || 2"
        :described-by="activity.label || adapter.suggestions?.visible ? statusId : adapter.composer.describedBy"
        :placeholder="suggestionPreview || adapter.composer.placeholder" :placeholder-affects-height="!suggestionPreview"
        :attachment-state="attachmentState" :dragging="attachmentsEnabled && adapter.attachments.dragActive"
        tab-to-submit @update:model-value="adapter.actions.setDraft($event)"
        @submit="submit" @tab-to-submit="delivery?.focus()"
        @focus="adapter.suggestions?.focus()" @blur="adapter.suggestions?.blur()"
        @escape="dismissSuggestions"
        @dragenter="attachmentEvent('handleDragEnter', $event)" @dragover="attachmentEvent('handleDragOver', $event)"
        @dragleave="attachmentEvent('handleDragLeave', $event)" @drop="attachmentEvent('handleDrop', $event)"
        @paste="attachmentEvent('handlePaste', $event)"
      >
        <template v-if="attachmentsEnabled" #attachments>
          <input ref="fileInput" hidden multiple type="file" :accept="adapter.attachments.accept" :disabled="!adapter.attachments.canAddFiles" @change="attachSelectedFiles">
          <AssistantAttachmentQueue
            :items="adapter.attachments.queueItems" :preview-enabled="Boolean(adapter.attachments.open)"
            :maximum-files="adapter.attachments.maxItems"
            @cancel="adapter.attachments.cancelAttachment($event)" @remove="adapter.attachments.removeAttachment($event)"
            @retry="adapter.attachments.retryAttachment($event)" @preview="adapter.attachments.open($event)" @focus-input="input?.focus()"
          />
        </template>
        <template v-if="adapter.questions || $slots['input-start']" #input-start>
          <slot name="input-start" :adapter="adapter">
            <AssistantQuestionInputs
              v-bind="adapter.questions"
              @update:answers="adapter.questions.setAnswers($event)" @update:choice="adapter.questions.setChoice($event)" @dismiss="adapter.questions.dismiss()"
            />
          </slot>
        </template>
        <template #footer>
          <AssistantComposerActions ref="delivery" :state="{ ...adapter.composer, pending, canSend }" @submit="submit" @stop="stop">
            <AssistantModelControl
              v-if="adapter.models && adapter.models.enabled !== false" v-model="modelsOpen" v-bind="adapter.models"
              @select-provider="adapter.models.selectProvider?.($event)" @select-model="adapter.models.selectModel?.($event)"
              @select-variant="adapter.models.selectVariant?.($event)" @apply="applyModel" @reload="adapter.models.reload?.()"
            />
            <v-btn
              v-if="attachmentsEnabled" aria-label="Attach files" title="Attach files" size="small" variant="text" :icon="mdiPaperclip"
              :disabled="!adapter.attachments.canAddFiles" @click="fileInput?.click()"
            />
            <slot
              v-if="configurationMode !== 'hidden'" name="configuration"
              :configuration="configuration" :disabled="configurationMode !== 'editable' || pending"
              :update="updateConfiguration"
            >
              <v-select
                v-for="field in configurationFields" :key="field.name"
                :model-value="configuration[field.name]" :label="field.label" :items="field.items"
                :disabled="configurationMode !== 'editable' || pending"
                density="compact" hide-details variant="outlined" class="assistant-conversation__setting"
                @update:model-value="updateConfiguration({ ...configuration, [field.name]: $event })"
              />
            </slot>
            <slot name="composer-tools" :adapter="adapter" />
            <template #feedback>
              <p v-if="attachmentsEnabled && adapter.attachments.status" role="alert" class="assistant-conversation__attachment-error">{{ adapter.attachments.status }}</p>
              <slot name="composer-feedback" :adapter="adapter" />
            </template>
          </AssistantComposerActions>
        </template>
      </AssistantPromptInput>
    </slot>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, useId, useSlots, watch } from "vue";
import { mdiAccountCircleOutline, mdiClose, mdiMinus, mdiPaperclip, mdiPencil } from "@mdi/js";
import AssistantTranscript from "./AssistantTranscript.vue";
import AssistantPromptInput from "./AssistantPromptInput.vue";
import AssistantComposerActions from "./AssistantComposerActions.vue";
import AssistantComposerSupport from "./AssistantComposerSupport.vue";
import AssistantGoalControl from "./AssistantGoalControl.vue";
import AssistantAttachmentQueue from "./AssistantAttachmentQueue.vue";
import AssistantQuestionInputs from "./AssistantQuestionInputs.vue";
import AssistantModelControl from "./AssistantModelControl.vue";
const props = defineProps({
  adapter: { type: Object, required: true },
  avatarSize: { type: String, default: "compact", validator: (value) => ["hidden", "compact", "standard", "large"].includes(value) },
  label: { type: String, default: "Assistant conversation" },
  configuration: { type: Object, default: () => ({}) },
  configurationFields: { type: Array, default: () => [] },
  configurationMode: { type: String, default: "hidden", validator: (value) => ["hidden", "readonly", "editable"].includes(value) }
});
const emit = defineEmits(["update:avatarSize"]);
const slots = useSlots();
const container = ref(null);
const avatarControls = ref(null);
const visibleAvatarSize = ref("compact");
watch(() => props.avatarSize, (size) => {
  if (size !== "hidden") visibleAvatarSize.value = size;
}, { immediate: true });
function toggleAvatar() {
  emit("update:avatarSize", props.avatarSize === "hidden" ? visibleAvatarSize.value : "hidden");
}
const avatarSizes = [
  { value: "hidden", height: 0 },
  { value: "compact", height: 96 },
  { value: "standard", height: 112 },
  { value: "large", height: 176 }
];
const avatarSpace = ref(0);
const avatarHeight = computed(() => Math.min(avatarSpace.value, avatarSizes.find(size => size.value === props.avatarSize).height));
let avatarObserver;
const observedAvatarElements = new Set();
function measureAvatarSpace() {
  const root = container.value;
  if (!root || !slots.avatar) return;
  const rootStyle = getComputedStyle(root);
  let occupied = parseFloat(rootStyle.paddingTop) + parseFloat(rootStyle.paddingBottom);
  for (const element of observedAvatarElements) {
    if (element === root) continue;
    const style = getComputedStyle(element);
    occupied += element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }
  // Shrink artwork before the composer, feedback, or the readable transcript.
  avatarSpace.value = Math.max(0, root.clientHeight - occupied - 120);
}
function observeAvatarSpace() {
  if (!container.value || !slots.avatar) {
    avatarObserver?.disconnect();
    observedAvatarElements.clear();
    return;
  }
  avatarObserver ||= new ResizeObserver(measureAvatarSpace);
  const fixedElements = Array.from(container.value.children).filter(element =>
    !element.classList.contains("assistant-conversation__avatar") && !element.classList.contains("assistant-conversation__transcript"));
  const elements = new Set([container.value, ...fixedElements]);
  if (avatarControls.value) elements.add(avatarControls.value);
  for (const element of observedAvatarElements) {
    if (!elements.has(element)) {
      avatarObserver.unobserve(element);
      observedAvatarElements.delete(element);
    }
  }
  for (const element of elements) {
    if (!observedAvatarElements.has(element)) {
      avatarObserver.observe(element);
      observedAvatarElements.add(element);
    }
  }
  measureAvatarSpace();
}
onMounted(observeAvatarSpace);
onUpdated(observeAvatarSpace);
onBeforeUnmount(() => avatarObserver?.disconnect());
const transcriptSlots = computed(() => ["welcome", "attachments", "system-message", "message-actions"].filter((name) => slots[name]));
const input = ref(null);
const fileInput = ref(null);
const modelsOpen = ref(false);
const delivery = ref(null);
const statusId = `assistant-status-${useId()}`;
const conversation = computed(() => {
  const saved = props.adapter.conversation;
  if (!props.adapter.delivery && !saved.previewMessage && !saved.previewMessages?.length && !saved.interimReply) return saved;
  const { previewMessage, previewMessages, interimReply, ...display } = saved;
  let turns = props.adapter.delivery ? props.adapter.delivery.turns(saved.turns || []) : saved.turns || [];
  if (interimReply?.text && interimReply.turnId) {
    const assistant = { ...interimReply, messageId: interimReply.id, role: "assistant" };
    turns = turns.map(turn => turn.turnId !== interimReply.turnId ? turn : {
      ...turn, assistant,
      commentary: (turn.commentary || []).filter(message =>
        (message.outputId || message.messageId) !== (interimReply.outputId || interimReply.id)),
      ...(Array.isArray(turn.messages) ? { messages: turn.messages.filter(message =>
        message.role !== "assistant" &&
        (message.outputId || message.messageId) !== (interimReply.outputId || interimReply.id)).concat(assistant) } : {})
    });
  }
  // This list projects existing capture/pending owners; it never queues delivery.
  const previews = Array.isArray(previewMessages) ? previewMessages : previewMessage ? [previewMessage] : [];
  for (const preview of previews) {
    const messageId = String(preview?.messageId || preview?.id || "").trim();
    const localDelivery = messageId && props.adapter.delivery?.find?.(messageId);
    if ((!localDelivery || localDelivery.status === "failed") && preview?.actions?.send) {
      // Keep one unadmitted bubble and its real status until explicit Edit/discard.
      // A receipt:false user row is not acknowledgement of the pending words.
      turns = turns.map(turn => {
        const failed = turn.optimistic?.id === messageId && turn.optimistic.status === "failed";
        const unadmitted = turn.user?.receipt === false && String(turn.user.messageId || turn.user.id || "") === messageId;
        if (!failed && !unadmitted) return turn;
        return { ...turn, preview: true, previewMessage: preview, user: { ...turn.user, text: String(preview.text || "") } };
      });
    }
    const alreadyShown = messageId && (localDelivery || turns.some(turn => [
      turn.system, turn.user, turn.assistant, ...(turn.thinking || []), ...(turn.commentary || []), ...(turn.messages || [])
    ].some(message => String(message?.messageId || message?.id || "") === messageId &&
      (message.receipt !== false || turn.preview))));
    if (messageId && (preview?.text || preview?.actions?.editing) && !alreadyShown) {
      const user = { messageId, role: "user", text: String(preview.text || "") };
      turns = [...turns, { turnId: messageId, user, messages: [user], preview: true, previewMessage: preview,
        optimistic: { id: messageId, status: "pending" } }];
    }
  }
  // Transcription and interim replies are display only. The receipt watcher
  // receives canonical turns, never these presentation or delivery overlays.
  return { ...display, turns, welcomeMessage: turns.length ? "" : saved.welcomeMessage };
});
watch([() => props.adapter.delivery, () => props.adapter.conversation.turns], ([controller, turns]) => {
  controller?.reconcile(turns || []);
}, { immediate: true });
const pending = computed(() => Boolean(props.adapter.delivery?.state.sending || props.adapter.composer?.pending));
const queueWhileSending = computed(() => props.adapter.composer?.queueWhileSending === true);
const working = computed(() => conversation.value.working ?? (!pending.value && Boolean(
  props.adapter.composer?.canStop || conversation.value.turns?.some(turn => turn.pending)
)));
const activity = computed(() => props.adapter.activity ?? {
  label: props.adapter.composer?.stopPending ? "Stopping…"
    : pending.value ? "Sending to assistant…" : working.value ? "Assistant is working…" : ""
});
const suggestionPreview = computed(() => !props.adapter.composer?.draft && props.adapter.suggestions?.visible
  ? props.adapter.suggestions.preview : "");
const attachmentsEnabled = computed(() => props.adapter.attachments && props.adapter.attachments.enabled !== false);
const attachmentState = computed(() => ({
  count: attachmentsEnabled.value ? props.adapter.attachments.queueItems?.length || 0 : 0,
  canSubmit: !attachmentsEnabled.value || props.adapter.attachments.canSubmit !== false
}));
const canSend = computed(() => (
  (!pending.value || (queueWhileSending.value && attachmentState.value.count === 0)) &&
  props.adapter.composer?.canSend && attachmentState.value.canSubmit
));
async function resend(id) {
  if (props.adapter.actions?.resend) return props.adapter.actions.resend(id);
  const controller = props.adapter.delivery;
  const payload = controller?.find(id)?.payload;
  const attachments = props.adapter.attachments;
  try {
    const response = await controller?.resend(id, { queue: queueWhileSending.value });
    clearAcceptedAttachments(response, payload, attachments);
    return response;
  }
  catch { /* The delivery controller retains the error beside the failed message. */ }
}
function cancel(id) {
  return props.adapter.actions?.cancel ? props.adapter.actions.cancel(id) : props.adapter.delivery?.cancel(id);
}
function edit(id) {
  if (props.adapter.actions?.edit) return props.adapter.actions.edit(id);
  if (!props.adapter.actions?.setDraft) return;
  const draft = props.adapter.delivery?.edit(id, props.adapter.composer?.draft || "");
  if (draft != null) { props.adapter.actions.setDraft(draft); input.value?.focus(); }
}
function attachmentEvent(method, event) {
  if (attachmentsEnabled.value) return props.adapter.attachments[method]?.(event);
}
function attachSelectedFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (attachmentsEnabled.value && props.adapter.attachments.canAddFiles) return props.adapter.attachments.uploadFiles(files);
}
async function applyModel() {
  if (await props.adapter.models.apply() !== false) modelsOpen.value = false;
}
function selectSuggestion(value) {
  if (props.adapter.suggestions?.select(value) !== false) input.value?.focus();
}
function dismissSuggestions() {
  props.adapter.suggestions?.dismiss();
  input.value?.focus();
}
function clearAcceptedAttachments(response, payload, attachments) {
  if (response !== false && response?.ok !== false && payload?.attachmentIds?.length) {
    attachments?.clearAttachments({ accepted: true, attachmentIds: payload.attachmentIds });
  }
}
async function submit() {
  if (!canSend.value) return;
  const attachments = props.adapter.attachments;
  const files = attachmentsEnabled.value ? props.adapter.attachments.attachments.map(item => ({ ...item })) : [];
  if (props.adapter.actions?.submit) return props.adapter.actions.submit({ configuration: props.configuration, attachments: files });
  const controller = props.adapter.delivery;
  if (!controller || !props.adapter.actions?.setDraft) return;
  const message = String(props.adapter.composer.draft || "").trim() ||
    (files.length ? props.adapter.composer.attachmentMessage || "Please review the attached files." : "");
  if (!message) return;
  const payload = {
    ...props.adapter.composer.payload,
    configuration: { ...props.configuration },
    message,
    ...(files.length ? { attachmentIds: files.map(file => file.attachmentId), displayAttachments: files } : {})
  };
  props.adapter.actions.setDraft("");
  try {
    const response = await controller.send(payload, { queue: queueWhileSending.value });
    clearAcceptedAttachments(response, payload, attachments);
    return response;
  } catch { return false; /* Delivery retains the failed message and its actions. */ }
}

function stop() {
  const state = props.adapter.composer;
  if (!state?.canStop || state.stopDisabled || state.stopPending) return;
  return props.adapter.actions.stop();
}
function updateConfiguration(value) {
  if (props.configurationMode !== "editable" || pending.value) return;
  return props.adapter.actions?.updateConfiguration?.(value);
}
defineExpose({ focus: () => input.value?.focus(), submit, stop });
</script>
<style scoped>
.assistant-conversation__preview-actions { display: flex; justify-content: flex-end; }
.assistant-conversation { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; gap: 0; container: assistant-conversation / inline-size; }
.assistant-conversation__avatar { position: absolute; top: 0; right: 0; z-index: 3; max-width: 100%; min-width: 0; }
.assistant-conversation__avatar-controls { position: absolute; top: 0; right: 100%; display: flex; align-items: center; justify-content: flex-end; min-height: 44px; }
.assistant-conversation__avatar--hidden .assistant-conversation__avatar-controls { right: 0; }
.assistant-conversation__avatar-size { min-width: 44px; min-height: 44px; }
.assistant-conversation__avatar-size-disc { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(var(--v-theme-on-surface), .08); }
.assistant-conversation__avatar-size-disc--minimise { background: rgba(var(--v-theme-primary), .12); }
.assistant-conversation__avatar-presentation { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.assistant-conversation__avatar-tools { display: flex; align-items: center; gap: 0; }
.assistant-conversation__avatar-visual { display: flex; justify-content: center; min-height: 0; overflow: hidden; }
.assistant-conversation__avatar-visual :deep(> *) { max-width: 100%; max-height: 100%; }
.assistant-conversation__goal { display: flex; justify-content: flex-end; flex: 0 0 auto; }
.assistant-conversation__transcript { flex: 1 1 auto; min-height: 0; }
.assistant-conversation__composer { flex: 0 0 auto; }
.assistant-conversation__attachment-error { flex-basis: 100%; margin: 0; }
.assistant-conversation__setting { min-width: 8rem; max-width: 16rem; }
</style>
