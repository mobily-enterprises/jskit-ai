<template>
  <section class="assistant-conversation" :aria-label="label">
    <AssistantTranscript
      v-bind="adapter.conversation" :working="working" class="assistant-conversation__transcript"
      @load-more="adapter.actions?.loadMore?.($event)" @reload="adapter.actions?.reload?.()"
      @resend-turn="adapter.actions?.resend?.($event)" @cancel-turn="adapter.actions?.cancel?.($event)"
      @edit-turn="adapter.actions?.edit?.($event)" @link-click="adapter.actions?.openLink?.($event)"
    >
      <template v-for="name in transcriptSlots" #[name]="scope"><slot :name="name" v-bind="scope" /></template>
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
          <AssistantComposerActions ref="delivery" :state="{ ...adapter.composer, canSend }" @submit="submit" @stop="stop">
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
              :configuration="configuration" :disabled="configurationMode !== 'editable' || adapter.composer.pending"
              :update="updateConfiguration"
            >
              <v-select
                v-for="field in configurationFields" :key="field.name"
                :model-value="configuration[field.name]" :label="field.label" :items="field.items"
                :disabled="configurationMode !== 'editable' || adapter.composer.pending"
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
import { computed, ref, useId, useSlots } from "vue";
import { mdiPaperclip } from "@mdi/js";
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
  label: { type: String, default: "Assistant conversation" },
  configuration: { type: Object, default: () => ({}) },
  configurationFields: { type: Array, default: () => [] },
  configurationMode: { type: String, default: "hidden", validator: (value) => ["hidden", "readonly", "editable"].includes(value) }
});
const slots = useSlots();
const transcriptSlots = computed(() => ["welcome", "attachments", "system-message", "message-actions"].filter((name) => slots[name]));
const input = ref(null);
const fileInput = ref(null);
const modelsOpen = ref(false);
const delivery = ref(null);
const statusId = `assistant-status-${useId()}`;
const working = computed(() => props.adapter.conversation.working ?? Boolean(
  props.adapter.composer?.canStop || props.adapter.conversation.turns?.some(turn => turn.pending)
));
const activity = computed(() => props.adapter.activity ?? {
  label: props.adapter.composer?.stopPending ? "Stopping…"
    : working.value
      ? "Assistant is working…" : props.adapter.composer?.pending ? "Sending to assistant…" : ""
});
const suggestionPreview = computed(() => !props.adapter.composer?.draft && props.adapter.suggestions?.visible
  ? props.adapter.suggestions.preview : "");
const attachmentsEnabled = computed(() => props.adapter.attachments && props.adapter.attachments.enabled !== false);
const attachmentState = computed(() => ({
  count: attachmentsEnabled.value ? props.adapter.attachments.queueItems?.length || 0 : 0,
  canSubmit: !attachmentsEnabled.value || props.adapter.attachments.canSubmit !== false
}));
const canSend = computed(() => props.adapter.composer?.canSend && attachmentState.value.canSubmit);
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
function submit() {
  if (!canSend.value) return;
  return props.adapter.actions.submit({ configuration: props.configuration, attachments: attachmentsEnabled.value ? props.adapter.attachments.attachments.map(item => ({ ...item })) : [] });
}
function stop() {
  const state = props.adapter.composer;
  if (!state?.canStop || state.stopDisabled || state.stopPending) return;
  return props.adapter.actions.stop();
}
function updateConfiguration(value) {
  if (props.configurationMode !== "editable" || props.adapter.composer?.pending) return;
  return props.adapter.actions?.updateConfiguration?.(value);
}
defineExpose({ focus: () => input.value?.focus(), submit, stop });
</script>
<style scoped>
.assistant-conversation { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; gap: 0; container: assistant-conversation / inline-size; }
.assistant-conversation__goal { display: flex; justify-content: flex-end; flex: 0 0 auto; }
.assistant-conversation__transcript { flex: 1 1 auto; min-height: 0; }
.assistant-conversation__composer { flex: 0 0 auto; }
.assistant-conversation__attachment-error { flex-basis: 100%; margin: 0; }
.assistant-conversation__setting { min-width: 8rem; max-width: 16rem; }
</style>
