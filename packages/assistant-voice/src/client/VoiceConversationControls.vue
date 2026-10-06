<script setup>
import { computed, useId } from "vue";
import { mdiMicrophone, mdiMicrophoneOff, mdiStop, mdiVolumeHigh, mdiVolumeOff } from "@mdi/js";
import { useVoiceLauncher } from "./voiceLauncher.js";

const props = defineProps({
  session: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  toolsTarget: { type: Object, default: null }
});
const {
  targetLabel, voice, error, microphoneMuted, live, starting, callMode,
  callStatus, speechActive, heldTranscript,
  capturing, pendingTranscript, pushHolding, sending,
  stopSpeech, startPushToTalk, finishPushToTalk, cancelPushToTalk, toggleHandsFree, readAloud, toggleReadAloud,
  deliverTranscript, discardHeldRecording, editTranscript
} = props.session;
const handsFreeListening = computed(() => live.value && callMode.value === "hands-free" && !microphoneMuted.value);
const canTalk = computed(() => !props.disabled && !sending.value && !pendingTranscript.value &&
  (!capturing.value || voice.listening.value || pushHolding.value || starting.value));
const talkLabel = computed(() => starting.value ? "Connecting…" : pushHolding.value ? "Release to send" : handsFreeListening.value ? "Pause" : "Talk");
const gestureHint = useId();
const gesture = useVoiceLauncher({
  enabled: canTalk,
  open: () => ({ startHeldRecording: startPushToTalk, finishHeldRecording: finishPushToTalk, discardHeldRecording: cancelPushToTalk }),
  onTap: toggleHandsFree,
  onError: cause => { error.value = cause.message; }
});
</script>

<template>
  <fieldset class="assistant-voice-controls" :class="{ 'assistant-voice-controls--compact': compact }" :disabled="disabled">
    <p v-if="error || voice.error.value" class="assistant-voice__error" role="alert">{{ error || voice.error.value }}</p>
    <p v-if="callStatus" class="assistant-voice-controls__status text-body-small" role="status">{{ callStatus }}</p>
    <p v-if="compact && heldTranscript && !pendingTranscript" class="assistant-voice-controls__provisional" role="status" aria-label="Recognized words">Not sent · {{ heldTranscript }}</p>
    <section v-if="pendingTranscript && (pendingTranscript.reviewBeforeSend || !sending)" class="assistant-voice__review" aria-label="Review voice message">
      <v-textarea
        :model-value="pendingTranscript.text" label="Review your message" :disabled="sending"
        :density="compact ? 'compact' : 'default'" :rows="compact ? 1 : 2" :max-rows="compact ? 2 : 3"
        auto-grow hide-details @update:model-value="editTranscript"
      />
      <div class="assistant-voice__review-actions">
        <v-btn :disabled="sending" min-height="48" @click="discardHeldRecording">Discard</v-btn>
        <v-btn :disabled="sending || !pendingTranscript.text.trim()" min-height="48" color="primary" @click="deliverTranscript">{{ sending ? 'Sending…' : 'Send' }}</v-btn>
      </div>
    </section>
    <Teleport :to="toolsTarget" :disabled="!toolsTarget">
      <fieldset class="assistant-voice-controls__tools" :class="{ 'assistant-voice-controls__tools--compact': compact }" :disabled="disabled" :aria-label="`${targetLabel} voice chat controls`">
        <v-btn v-if="speechActive" :icon="mdiStop" variant="text" min-width="48" min-height="48" :aria-label="`Stop ${targetLabel} speaking`" title="Stop speaking" @click="stopSpeech" />
        <slot name="work-control" />
        <div class="assistant-voice__talk-action">
          <v-btn
            class="assistant-voice__talk" color="primary" :variant="handsFreeListening ? 'tonal' : 'flat'" :min-height="compact ? 48 : 64" rounded="xl"
            :prepend-icon="voice.listening.value && !microphoneMuted ? mdiMicrophone : mdiMicrophoneOff" :aria-pressed="handsFreeListening || pushHolding" :aria-describedby="gestureHint"
            :disabled="!canTalk"
            @pointerdown="gesture.pointerDown" @pointerup="gesture.pointerUp" @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel"
            @keydown.space.prevent="gesture.keyDown" @keyup.space.prevent="gesture.keyUp"
            @keydown.enter.prevent="gesture.keyDown" @keyup.enter.prevent="gesture.keyUp" @blur="gesture.cancel" @contextmenu.prevent @click="gesture.click"
          >
            {{ talkLabel }}
          </v-btn>
          <v-btn
            :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" :aria-pressed="readAloud" variant="tonal" :min-height="compact ? 48 : 64" :min-width="compact ? 48 : 64" rounded="xl"
            :aria-label="readAloud ? `Turn ${targetLabel} read-aloud off` : `Read ${targetLabel} answers aloud`"
            :title="readAloud ? 'Spoken replies on' : 'Spoken replies off'" @click="toggleReadAloud"
          />
          <p :id="gestureHint" class="text-body-small text-medium-emphasis">{{ handsFreeListening ? 'Tap to pause · hold to speak' : 'Tap for hands-free · hold to speak' }}</p>
        </div>
      </fieldset>
    </Teleport>
  </fieldset>
</template>

<style scoped>
.assistant-voice-controls, .assistant-voice-controls__tools { border: 0; padding: 0; margin: 0; min-width: 0; }
.assistant-voice-controls { flex: 0 0 auto; }
.assistant-voice-controls--compact { flex: 1 1 100%; width: 100%; }
.assistant-voice-controls__tools { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; }
.assistant-voice-controls__status { text-align: center; margin: 0; }
.assistant-voice-controls__provisional { margin: 0; max-height: 3rem; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant-voice__talk-action { width: min(288px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) 64px; gap: 6px 8px; padding: 16px; }
.assistant-voice__talk { touch-action: none; user-select: none; -webkit-touch-callout: none; }
.assistant-voice__talk-action p { grid-column: 1 / -1; margin: 0; text-align: center; white-space: nowrap; }
.assistant-voice__review { flex: 0 0 auto; max-height: 160px; overflow-y: auto; padding: 8px 16px; }
.assistant-voice__review-actions { display: flex; justify-content: flex-end; gap: 8px; }
.assistant-voice__error { padding: 8px 16px; color: rgb(var(--v-theme-error)); }
.assistant-voice-controls__tools--compact { justify-content: flex-start; gap: 4px; }
.assistant-voice-controls__tools--compact .assistant-voice__talk-action { display: flex; padding: 0; width: auto; gap: 4px; }
.assistant-voice-controls__tools--compact .assistant-voice__talk-action p { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.assistant-voice-controls--compact .assistant-voice__review { max-height: 128px; padding: 0; }
.assistant-voice-controls--compact .assistant-voice__error { margin: 0; padding: 0; }
@media (max-height: 650px) { .assistant-voice__talk-action { padding-top: 8px; } }
</style>
