<script setup>
import { computed, useId } from "vue";
import { mdiMicrophone, mdiMicrophoneOff, mdiStop, mdiVolumeHigh, mdiVolumeOff } from "@mdi/js";
import { useVoiceLauncher } from "./voiceLauncher.js";

const props = defineProps({
  session: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  iconOnly: { type: Boolean, default: false },
  reviewInTranscript: { type: Boolean, default: false },
  toolsTarget: { type: Object, default: null },
  feedbackTarget: { type: Object, default: null }
});
const {
  targetLabel, voice, error, microphoneMuted, live, starting, callMode,
  callStatus, speechActive, heldTranscript,
  capturing, pendingTranscript, pushHolding, sending,
  stopSpeech, startPushToTalk, finishPushToTalk, cancelPushToTalk, toggleHandsFree, readAloud, toggleReadAloud, enableSound,
  deliverTranscript, discardHeldRecording, editTranscript
} = props.session;
const controlStatus = computed(() => {
  if (props.iconOnly && voice.listening.value && !starting.value && !error.value && !voice.error.value) return "";
  if (!props.compact || !props.session.hasUnsentSpeech.value) return callStatus.value;
  if (pendingTranscript.value) return props.reviewInTranscript ? "" : "Send or discard speech to send text.";
  if (live.value && callMode.value === "hands-free" && voice.listening.value && !microphoneMuted.value) return "Listening…";
  return voice.listening.value ? "Recording · finish speech to send text." : "Finish speech to send text.";
});
const handsFreeListening = computed(() => live.value && callMode.value === "hands-free" && voice.listening.value && !microphoneMuted.value);
const canTalk = computed(() => !props.disabled && (!capturing.value || voice.listening.value || pushHolding.value || starting.value));
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
    <Teleport :to="feedbackTarget" :disabled="!feedbackTarget">
      <fieldset class="assistant-voice-controls__feedback" :class="{ 'assistant-voice-controls__feedback--compact': compact }" :disabled="disabled">
        <p
          v-if="error || voice.error.value" class="assistant-voice__error"
          :class="{ 'text-body-small': compact }" role="alert"
        >
          {{ error || voice.error.value }}
        </p>
        <p v-if="controlStatus" class="assistant-voice-controls__status text-body-small" role="status" :title="callStatus">{{ controlStatus }}</p>
        <p v-if="compact && !reviewInTranscript && heldTranscript && !pendingTranscript" class="assistant-voice-controls__provisional" role="status" aria-label="Recognized words">Not sent · {{ heldTranscript }}</p>
        <p v-if="readAloud && voice.playbackBlocked?.value" class="assistant-voice-controls__status" role="status">Sound is blocked. Enable sound to hear future replies.</p>
        <v-btn v-if="readAloud && voice.playbackBlocked?.value" min-height="48" @click="enableSound">Enable sound</v-btn>
        <section v-if="!reviewInTranscript && pendingTranscript && (pendingTranscript.reviewBeforeSend || !sending)" class="assistant-voice__review" aria-label="Review voice message">
          <v-textarea
            class="assistant-voice__review-input" :model-value="pendingTranscript.text" label="Review your message" :disabled="sending"
            :density="compact ? 'compact' : 'default'" :rows="compact ? 1 : 2" :max-rows="compact ? 2 : 3"
            auto-grow hide-details @update:model-value="editTranscript"
          />
          <div class="assistant-voice__review-actions">
            <v-btn :disabled="sending" min-height="48" @click="discardHeldRecording">Discard</v-btn>
            <v-btn :disabled="sending || !pendingTranscript.text.trim()" min-height="48" color="primary" @click="deliverTranscript">{{ sending ? 'Sending…' : 'Send' }}</v-btn>
          </div>
        </section>
      </fieldset>
    </Teleport>
    <Teleport :to="toolsTarget" :disabled="!toolsTarget">
      <fieldset class="assistant-voice-controls__tools" :class="{ 'assistant-voice-controls__tools--compact': compact, 'assistant-voice-controls__tools--icons': iconOnly }" :disabled="disabled" :aria-label="`${targetLabel} voice chat controls`">
        <div v-if="compact || iconOnly || speechActive" class="assistant-voice-controls__stop">
          <v-btn v-if="speechActive" :icon="mdiStop" variant="text" min-width="48" min-height="48" :aria-label="`Stop ${targetLabel} speaking`" title="Stop speaking" @click="stopSpeech" />
        </div>
        <slot name="work-control" />
        <div class="assistant-voice__talk-action">
          <v-btn
            class="assistant-voice__talk" color="primary" :variant="iconOnly ? 'text' : handsFreeListening ? 'tonal' : 'flat'" :min-height="iconOnly ? 44 : compact ? 48 : 64" rounded="xl"
            :icon="iconOnly ? (voice.listening.value && !microphoneMuted ? mdiMicrophone : mdiMicrophoneOff) : undefined"
            :prepend-icon="iconOnly ? undefined : (voice.listening.value && !microphoneMuted ? mdiMicrophone : mdiMicrophoneOff)"
            :aria-label="iconOnly ? talkLabel : undefined" title="click or long press to talk"
            :aria-pressed="handsFreeListening || pushHolding" :aria-describedby="gestureHint"
            :disabled="!canTalk" :slim="compact || iconOnly"
            :width="iconOnly ? 40 : compact ? 148 : undefined" :min-width="iconOnly ? 40 : compact ? 148 : undefined"
            @pointerdown="gesture.pointerDown" @pointerup="gesture.pointerUp" @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel"
            @keydown.space.prevent="gesture.keyDown" @keyup.space.prevent="gesture.keyUp"
            @keydown.enter.prevent="gesture.keyDown" @keyup.enter.prevent="gesture.keyUp" @blur="gesture.cancel" @contextmenu.prevent @click="gesture.click"
          >
            <span v-if="iconOnly" class="assistant-voice-controls__icon-disc"><v-icon size="20" :icon="voice.listening.value && !microphoneMuted ? mdiMicrophone : mdiMicrophoneOff" /></span>
            <template v-else>{{ talkLabel }}</template>
          </v-btn>
          <v-btn
            :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" :aria-pressed="readAloud" :variant="iconOnly ? 'text' : 'tonal'" :color="iconOnly ? 'primary' : undefined" :min-height="iconOnly ? 44 : compact ? 48 : 64" :width="iconOnly ? 40 : undefined" :min-width="iconOnly ? 40 : compact ? 48 : 64" rounded="xl"
            :aria-label="readAloud ? `Turn ${targetLabel} read-aloud off` : `Read ${targetLabel} answers aloud`"
            :title="readAloud ? 'Spoken replies on' : 'Spoken replies off'" @click="toggleReadAloud"
          >
            <template v-if="iconOnly" #default>
              <span class="assistant-voice-controls__icon-disc"><v-icon size="20" :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" /></span>
            </template>
          </v-btn>
          <slot name="settings-control" />
          <p :id="gestureHint" class="text-body-small text-medium-emphasis">{{ handsFreeListening ? 'Tap to pause · hold to speak' : 'Tap for hands-free · hold to speak' }}</p>
        </div>
      </fieldset>
    </Teleport>
  </fieldset>
</template>

<style scoped>
.assistant-voice-controls, .assistant-voice-controls__feedback, .assistant-voice-controls__tools { border: 0; padding: 0; margin: 0; min-width: 0; }
.assistant-voice-controls { flex: 0 0 auto; }
.assistant-voice-controls--compact { flex: 1 1 100%; width: 100%; }
.assistant-voice-controls__tools { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; }
.assistant-voice-controls__status { text-align: center; margin: 0; }
.assistant-voice-controls__feedback--compact > .assistant-voice-controls__status { min-height: 1lh; }
.assistant-voice-controls__stop { display: contents; }
.assistant-voice-controls__tools--compact .assistant-voice-controls__stop {
  display: block;
  flex: 0 0 48px;
  height: 48px;
}
.assistant-voice-controls__provisional { margin: 0; max-height: 3rem; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant-voice__talk-action { width: min(288px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) 64px; gap: 6px 8px; padding: 16px; }
.assistant-voice__talk { touch-action: none; user-select: none; -webkit-touch-callout: none; }
.assistant-voice__talk-action p { grid-column: 1 / -1; margin: 0; text-align: center; white-space: nowrap; }
.assistant-voice__review { flex: 0 0 auto; max-height: 160px; overflow-y: auto; padding: 8px 16px; }
.assistant-voice__review-actions { display: flex; justify-content: flex-end; gap: 8px; }
.assistant-voice__error { padding: 8px 16px; color: rgb(var(--v-theme-error)); }
.assistant-voice-controls__tools--compact { justify-content: flex-start; gap: 2px; }
.assistant-voice-controls__tools--compact .assistant-voice__talk-action { display: flex; padding: 0; width: auto; gap: 0; }
.assistant-voice-controls__tools--compact .assistant-voice__talk-action p { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.assistant-voice-controls__tools--icons { position: relative; width: max-content; flex-wrap: nowrap; justify-content: flex-end; gap: 0; }
.assistant-voice-controls__tools--icons .assistant-voice-controls__stop { position: absolute; right: calc(100% + 2px); top: 0; width: 48px; height: 48px; pointer-events: none; }
.assistant-voice-controls__tools--icons .assistant-voice-controls__stop > .v-btn { pointer-events: auto; }
.assistant-voice-controls__icon-disc { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); }
.assistant-voice-controls__tools--icons .assistant-voice__talk-action { display: flex; padding: 0; width: auto; gap: 0; }
.assistant-voice-controls__tools--icons .assistant-voice__talk-action p { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.assistant-voice-controls__feedback--compact .assistant-voice__review {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  max-height: 128px;
  padding: 0;
}
.assistant-voice-controls__feedback--compact .assistant-voice__review-input { flex: 1 1 auto; min-width: 0; }
.assistant-voice-controls__feedback--compact .assistant-voice__review-actions { flex: 0 0 auto; }
.assistant-voice-controls__feedback--compact .assistant-voice__error { margin: 0; padding: 0; }
@media (max-height: 650px) { .assistant-voice__talk-action { padding-top: 8px; } }
</style>
