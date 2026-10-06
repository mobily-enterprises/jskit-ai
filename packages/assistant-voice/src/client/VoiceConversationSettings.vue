<script setup>
import { mdiCog } from "@mdi/js";
import { useSlots } from "vue";

const props = defineProps({
  voice: { type: Object, default: null },
  compact: Boolean
});
const emit = defineEmits(["error"]);
const slots = useSlots();
async function openSettings(open) {
  if (!open || slots.default || !props.voice) return;
  try { await props.voice.connect(); }
  catch (error) { emit("error", error); }
}
</script>

<template>
  <v-menu :close-on-content-click="false" location="bottom end" @update:model-value="openSettings">
    <template #activator="{ props: settingsButton }">
      <v-btn
        v-bind="settingsButton" :icon="mdiCog" variant="text" :color="compact ? 'primary' : undefined"
        :min-width="compact ? 44 : 48" :min-height="compact ? 44 : 48" :disabled="!voice && !$slots.default"
        aria-label="Voice settings" title="Voice settings"
      >
        <template v-if="compact" #default><span class="voice-settings__disc"><v-icon size="20" :icon="mdiCog" /></span></template>
      </v-btn>
    </template>
    <v-card class="voice-settings__menu" role="region" aria-label="Voice settings">
      <v-card-text>
        <slot :voice="voice">
          <v-select
            v-if="voice" v-model="voice.selectedVoice.value"
            :items="voice.availableVoices.value" item-title="label" item-value="id"
            :disabled="voice.availableVoices.value.length < 2"
            label="Speaking voice" density="comfortable"
            hint="Applies to the next spoken reply" persistent-hint
          />
        </slot>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.voice-settings__menu { width: 320px; max-width: calc(100vw - 32px); }
.voice-settings__disc { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); }
</style>
