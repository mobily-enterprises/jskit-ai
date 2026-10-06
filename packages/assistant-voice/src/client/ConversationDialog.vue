<script setup>
import { mdiClose, mdiMessageTextOutline, mdiMicrophone, mdiMinus } from "@mdi/js";
import { useDisplay } from "vuetify";

const { xs } = useDisplay();

const props = defineProps({
  modelValue: Boolean,
  activator: { type: Object, default: null },
  title: { type: String, default: "Assistant" },
  mode: { type: String, default: "talk" },
  showModes: Boolean,
  minimizable: Boolean,
  closeLabel: { type: String, default: "Close conversation" }
});
const emit = defineEmits(["update:modelValue", "update:mode", "minimize"]);
let dismissedFromActivator = false;
function outsideClick(event) {
  // The scrim receives a pointer aimed at the covered launcher.
  const bounds = props.minimizable && props.activator?.getBoundingClientRect();
  dismissedFromActivator = Boolean(bounds && event.clientX >= bounds.left && event.clientX <= bounds.right &&
    event.clientY >= bounds.top && event.clientY <= bounds.bottom);
}
function updateOpen(value) {
  if (!value && dismissedFromActivator) emit("minimize");
  else emit("update:modelValue", value);
  dismissedFromActivator = false;
}
</script>

<template>
  <v-dialog
    class="conversation-dialog" :activator="activator" :open-on-click="false"
    :model-value="modelValue" :transition="false" :fullscreen="xs" :width="xs ? '100%' : 620" :max-width="xs ? '100%' : 'calc(100% - 32px)'"
    :height="xs ? '100%' : 860" :max-height="xs ? '100%' : 'calc(100% - 32px)'"
    :content-props="{ style: { margin: xs ? 0 : '16px' } }" :aria-label="`${title} conversation`" :aria-hidden="!modelValue"
    @click:outside="outsideClick" @update:model-value="updateOpen"
  >
    <v-card class="conversation-dialog__surface" :rounded="xs ? 0 : 'lg'">
      <v-card-title class="conversation-dialog__title text-title-large">
        <span :title="title">{{ title }}</span>
        <slot name="header-actions" />
        <v-btn v-if="minimizable" :icon="mdiMinus" variant="text" aria-label="Minimize conversation" title="Minimize conversation" @click="$emit('minimize')" />
        <v-btn :icon="mdiClose" variant="text" :aria-label="closeLabel" :title="closeLabel" @click="$emit('update:modelValue', false)" />
      </v-card-title>
      <v-tabs v-if="showModes" :model-value="mode" class="conversation-dialog__tabs" grow aria-label="Conversation mode" @update:model-value="$emit('update:mode', $event)">
        <v-tab value="talk" :prepend-icon="mdiMicrophone">Talk</v-tab>
        <v-tab value="text" :prepend-icon="mdiMessageTextOutline">Text</v-tab>
      </v-tabs>
      <div class="conversation-dialog__body"><slot /></div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* VOverlay animates its scrim independently of the dialog transition. */
.conversation-dialog :deep(.v-overlay__scrim) { transition: none; opacity: var(--v-overlay-opacity); }
.conversation-dialog:not(.v-overlay--active) :deep(.v-overlay__scrim) { display: none; }
.conversation-dialog__surface { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
.conversation-dialog__title { display: flex; align-items: center; flex: 0 0 64px; height: 64px; gap: 8px; padding: 8px 16px; }
.conversation-dialog__title > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-dialog__tabs { flex: 0 0 48px; height: 48px; }
.conversation-dialog__body { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
@media (max-width: 599px) {
  .conversation-dialog__surface { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
}
</style>
