<script setup>
import { useShellUiText } from "./shellUi.js";

// The kit's Material dialog (shell-web's Dialog role): a Vuetify dialog whose card holds the title, the body and the
// actions, the main one last. Escape and a click outside ask the view to close it (`close`); the view decides, and
// gives focus back where it was.
defineProps({
  open: { type: Boolean, required: true },
  // Names the dialog and heads it.
  title: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const text = useShellUiText();
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="440"
    :aria-label="title"
    @update:model-value="(shown) => shown || emit('close')"
  >
    <v-card>
      <v-card-text class="shell-ui-dialog">
        <h2 :class="[text.heading, 'mb-2']">{{ title }}</h2>
        <slot />
        <div v-if="$slots.actions" class="shell-ui-dialog__actions">
          <slot name="actions" />
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.shell-ui-dialog {
  padding: 24px;
}

.shell-ui-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
