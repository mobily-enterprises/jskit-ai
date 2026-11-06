<script setup>
import { useSlots } from "vue";
import VoiceSpeakingVoiceSelect from "./VoiceSpeakingVoiceSelect.vue";
import { useJskitText } from "./i18n.js";

const props = defineProps({
  // readable-check: allow collaborator-prop - optional operation: a conversation without voice passes no voice session, and the menu has no speaking voice to choose
  voice: { type: /** @type {import("vue").PropType<import("./types.js").VoiceTransport | null>} */ (Object), default: null },
  compact: Boolean
});
const emit = defineEmits(["error"]);
const { t } = useJskitText();
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
        v-bind="settingsButton" icon="$settings" variant="text" :color="compact ? 'primary' : undefined"
        :width="compact ? 40 : undefined" :min-width="compact ? 40 : 48" :min-height="compact ? 44 : 48" :disabled="!voice && !$slots.default"
        :aria-label="t('jskit.assistant.voice.settings.title')" :title="t('jskit.assistant.voice.settings.title')"
      >
        <template v-if="compact" #default><span class="voice-settings__disc"><v-icon size="20" icon="$settings" /></span></template>
      </v-btn>
    </template>
    <v-card class="voice-settings__menu" role="region" :aria-label="t('jskit.assistant.voice.settings.title')">
      <v-card-text>
        <slot :voice="voice">
          <VoiceSpeakingVoiceSelect v-if="voice" :voice="voice" />
        </slot>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.voice-settings__menu { width: 320px; max-width: calc(100vw - 32px); }
.voice-settings__disc { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); }
</style>
