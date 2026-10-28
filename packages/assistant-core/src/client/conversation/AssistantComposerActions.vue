<template>
  <div class="assistant-composer-actions" :class="{ 'assistant-composer-actions--compact': state.density === 'compact' }">
    <div class="assistant-composer-actions__tools"><slot /></div>
    <div class="assistant-composer-actions__delivery">
      <v-btn
        v-if="state.canStop" color="error" :disabled="state.stopDisabled || state.stopPending"
        :aria-busy="state.stopPending ? 'true' : undefined" :prepend-icon="mdiStopCircleOutline"
        size="small" variant="tonal" @click="emit('stop')"
      >
        {{ state.stopPending ? t('jskit.assistant.composer.stopping') : t('jskit.assistant.composer.stop') }}
      </v-btn>
      <v-btn
        ref="sendButton" class="assistant-composer-actions__send" color="primary" :disabled="!state.canSend"
        :aria-busy="state.pending && !state.canSend ? 'true' : undefined" :aria-label="state.submitAriaLabel || state.submitLabel || t('jskit.assistant.composer.sendMessage')"
        :title="state.submitTitle" :prepend-icon="state.submitIcon || mdiSend" size="small" variant="flat"
        @click="emit('submit')"
      >
        {{ state.submitLabel || (state.pending && !state.canSend ? t('jskit.assistant.composer.sending') : t('jskit.assistant.composer.send')) }}
      </v-btn>
    </div>
    <slot name="feedback" />
  </div>
</template>
<script setup>
import { ref } from "vue";
import { mdiSend, mdiStopCircleOutline } from "@mdi/js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
defineProps({ state: { type: Object, required: true } });
const emit = defineEmits(["submit", "stop"]);
const sendButton = ref(null);
defineExpose({ focus() { (sendButton.value?.$el || sendButton.value)?.focus?.(); } });
</script>
<style scoped>
.assistant-composer-actions, .assistant-composer-actions__tools, .assistant-composer-actions__delivery {
  align-items: center; display: flex; gap: 0.3rem; min-width: 0;
}
.assistant-composer-actions { flex-wrap: wrap; justify-content: space-between; }
.assistant-composer-actions__tools { flex: 1 1 auto; flex-wrap: wrap; }
.assistant-composer-actions__delivery { flex: 0 0 auto; margin-left: auto; }
.assistant-composer-actions__send { min-width: 5.25rem; }
.assistant-composer-actions--compact .assistant-composer-actions__delivery > .v-btn { min-height: 3rem; }
@media (max-width: 600px), (pointer: coarse) {
  .assistant-composer-actions__delivery > .v-btn { min-height: 3rem; min-width: 3rem; }
  .assistant-composer-actions__delivery > .assistant-composer-actions__send { min-width: 5.25rem; }
}
</style>
