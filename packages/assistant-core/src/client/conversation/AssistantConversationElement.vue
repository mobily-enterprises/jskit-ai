<template>
  <section class="assistant-conversation" :aria-label="label">
    <AssistantTranscript
      v-bind="adapter.conversation" class="assistant-conversation__transcript"
      @load-more="adapter.actions?.loadMore?.($event)" @reload="adapter.actions?.reload?.()"
      @resend-turn="adapter.actions?.resend?.($event)" @cancel-turn="adapter.actions?.cancel?.($event)"
      @edit-turn="adapter.actions?.edit?.($event)" @link-click="adapter.actions?.openLink?.($event)"
    >
      <template v-for="name in transcriptSlots" #[name]="scope"><slot :name="name" v-bind="scope" /></template>
    </AssistantTranscript>
    <slot name="hints" :adapter="adapter" />
    <slot name="composer" :adapter="adapter">
      <AssistantPromptInput
        v-if="adapter.composer" ref="input" v-bind="adapter.composer" class="assistant-conversation__composer"
        :model-value="adapter.composer.draft || ''" :submit-enabled="adapter.composer.canSend"
        :aria-label="adapter.composer.ariaLabel || 'Message AI assistant'" :rows="adapter.composer.rows || 2"
        tab-to-submit @update:model-value="adapter.actions.setDraft($event)"
        @submit="submit" @tab-to-submit="delivery?.focus()"
      >
        <template v-if="$slots['input-start']" #input-start><slot name="input-start" :adapter="adapter" /></template>
        <template #footer>
          <AssistantComposerActions ref="delivery" :state="adapter.composer" @submit="submit" @stop="stop">
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
          </AssistantComposerActions>
        </template>
      </AssistantPromptInput>
    </slot>
  </section>
</template>
<script setup>
import { computed, ref, useSlots } from "vue";
import AssistantTranscript from "./AssistantTranscript.vue";
import AssistantPromptInput from "./AssistantPromptInput.vue";
import AssistantComposerActions from "./AssistantComposerActions.vue";
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
const delivery = ref(null);
function submit() {
  if (!props.adapter.composer?.canSend) return;
  return props.adapter.actions.submit({ configuration: props.configuration });
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
.assistant-conversation { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; gap: 0; }
.assistant-conversation__transcript { flex: 1 1 auto; min-height: 0; }
.assistant-conversation__composer { flex: 0 0 auto; }
.assistant-conversation__setting { min-width: 8rem; max-width: 16rem; }
</style>
