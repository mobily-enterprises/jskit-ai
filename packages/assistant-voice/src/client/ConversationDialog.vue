<script setup>
import { mdiClose, mdiMessageTextOutline, mdiMicrophone, mdiMinus } from "@mdi/js";
import { useDisplay } from "vuetify";
import { VCard, VDialog } from "vuetify/components";
import { computed } from "vue";

const { xs } = useDisplay();

const props = defineProps({
  modelValue: Boolean,
  activator: { type: Object, default: null },
  title: { type: String, default: "Assistant" },
  mode: { type: String, default: "talk" },
  showModes: Boolean,
  minimizable: Boolean,
  closeLabel: { type: String, default: "Close conversation" },
  presentation: { type: String, default: "dialog", validator: value => ["dialog", "inline"].includes(value) }
});
const dialogProps = computed(() => props.presentation === "inline" ? {} : {
  activator: props.activator, openOnClick: false, modelValue: props.modelValue,
  transition: false, fullscreen: xs.value, width: xs.value ? "100%" : 620,
  maxWidth: xs.value ? "100%" : "calc(100% - 32px)", height: xs.value ? "100%" : 860,
  maxHeight: xs.value ? "100%" : "calc(100% - 32px)",
  contentProps: { style: { margin: xs.value ? 0 : "16px" } },
  "aria-hidden": !props.modelValue
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
  <component
    :is="presentation === 'inline' ? 'section' : VDialog" v-bind="dialogProps"
    class="conversation-dialog" :class="{ 'conversation-dialog--inline': presentation === 'inline' }" :aria-label="`${title} conversation`"
    @click:outside="outsideClick" @update:model-value="updateOpen"
  >
    <component :is="presentation === 'inline' ? 'div' : VCard" class="conversation-dialog__surface" :rounded="presentation === 'inline' ? undefined : xs ? 0 : 'lg'">
      <v-card-title v-if="presentation !== 'inline'" class="conversation-dialog__title text-title-large">
        <span :title="title">{{ title }}</span>
        <slot name="header-actions" />
        <v-btn v-if="minimizable" :icon="mdiMinus" variant="text" aria-label="Minimize conversation" title="Minimize conversation" @click="$emit('minimize', $event)" />
        <v-btn :icon="mdiClose" variant="text" :aria-label="closeLabel" :title="closeLabel" @click="$emit('update:modelValue', false)" />
      </v-card-title>
      <v-tabs v-if="showModes" :model-value="mode" class="conversation-dialog__tabs" grow aria-label="Conversation mode" @update:model-value="$emit('update:mode', $event)">
        <v-tab value="talk" :prepend-icon="mdiMicrophone">Talk</v-tab>
        <v-tab value="text" :prepend-icon="mdiMessageTextOutline">Text</v-tab>
      </v-tabs>
      <div class="conversation-dialog__body"><slot /></div>
    </component>
  </component>
</template>

<style scoped>
/* VOverlay animates its scrim independently of the dialog transition. */
.conversation-dialog :deep(.v-overlay__scrim) { transition: none; opacity: var(--v-overlay-opacity); }
.conversation-dialog:not(.v-overlay--active) :deep(.v-overlay__scrim) { display: none; }
.conversation-dialog__surface { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
.conversation-dialog--inline { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.conversation-dialog--inline .conversation-dialog__surface { height: auto; }
.conversation-dialog__title { display: flex; align-items: center; flex: 0 0 64px; height: 64px; gap: 8px; padding: 8px 16px; }
.conversation-dialog__title > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-dialog__tabs { flex: 0 0 48px; height: 48px; }
.conversation-dialog__body { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
@media (max-width: 599px) {
  .conversation-dialog:not(.conversation-dialog--inline) .conversation-dialog__surface { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
}
</style>
