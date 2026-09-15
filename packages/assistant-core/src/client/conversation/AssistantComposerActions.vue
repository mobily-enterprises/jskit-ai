<template>
  <div class="assistant-composer-actions">
    <div class="assistant-composer-actions__tools"><slot /></div>
    <div class="assistant-composer-actions__delivery">
      <v-btn
        v-if="state.canStop" color="error" :disabled="state.stopDisabled || state.stopPending"
        :aria-busy="state.stopPending ? 'true' : undefined" :prepend-icon="mdiStopCircleOutline"
        size="small" variant="tonal" @click="emit('stop')"
      >
        {{ state.stopPending ? 'Stopping…' : 'Stop' }}
      </v-btn>
      <v-btn
        ref="sendButton" class="assistant-composer-actions__send" color="primary" :disabled="!state.canSend"
        :aria-busy="state.pending ? 'true' : undefined" :aria-label="state.submitAriaLabel || state.submitLabel || 'Send message'"
        :title="state.submitTitle" :prepend-icon="state.submitIcon || mdiSend" size="small" variant="flat"
        @click="emit('submit')"
      >
        {{ state.submitLabel || (state.pending ? 'Sending…' : 'Send') }}
      </v-btn>
    </div>
  </div>
</template>
<script setup>
import { ref } from "vue";
import { mdiSend, mdiStopCircleOutline } from "@mdi/js";
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
@media (pointer: coarse) {
  .assistant-composer-actions__delivery > .v-btn { min-height: 3rem; min-width: 3rem; }
  .assistant-composer-actions__delivery > .assistant-composer-actions__send { min-width: 5.25rem; }
}
</style>
