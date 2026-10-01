<script setup>
import { computed, ref, useId, watch } from "vue";
import { mdiMicrophone, mdiMicrophoneOff, mdiStop, mdiVolumeHigh, mdiVolumeOff } from "@mdi/js";
import VoiceAvatar from "./VoiceAvatar.vue";
import { useVoiceLauncher } from "./voiceLauncher.js";

const props = defineProps({ session: { type: Object, required: true }, disabled: { type: Boolean, default: false } });
const {
  targetLabel, voice, error, microphoneMuted, live, starting, callMode,
  callStatus, callAudioLevel, avatarVisual, speechActive, heldTranscript,
  capturing, pendingTranscript, voiceWords, voiceAnswer, pushHolding, sending,
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
const voiceWordsTarget = ref(null);
const voiceAnswerTarget = ref(null);
const followWords = ref(true);
const followAnswer = ref(true);
function isAtBottom(element) { return element.scrollHeight - element.scrollTop - element.clientHeight < 24; }
for (const [text, target, following] of [[voiceWords, voiceWordsTarget, followWords], [voiceAnswer, voiceAnswerTarget, followAnswer]]) {
  watch(text, () => {
    if (target.value && following.value) target.value.scrollTop = target.value.scrollHeight;
  }, { flush: "post" });
}
</script>

<template>
  <fieldset class="assistant-voice" :disabled="disabled">
    <p v-if="error || voice.error.value" class="assistant-voice__error" role="alert">{{ error || voice.error.value }}</p>
    <section class="assistant-voice__call" :aria-label="`${targetLabel} voice chat controls`">
      <div class="assistant-voice__call-body">
        <div class="assistant-voice__call-portrait" :style="{ '--call-audio-scale': 1 + callAudioLevel * .16 }" aria-hidden="true">
          <slot name="avatar" v-bind="avatarVisual"><VoiceAvatar v-bind="avatarVisual" /></slot>
        </div>
        <div class="assistant-voice__call-status-row">
          <p class="text-title-medium" role="status">{{ callStatus }}</p>
          <v-btn v-if="speechActive" :icon="mdiStop" variant="text" min-width="48" min-height="48" :aria-label="`Stop ${targetLabel} speaking`" title="Stop speaking" @click="stopSpeech" />
          <slot name="work-control" />
        </div>
      </div>
      <div class="assistant-voice__captions" aria-label="Voice conversation text">
        <section ref="voiceWordsTarget" class="assistant-voice__caption" aria-label="Recognized words" tabindex="0" @scroll="followWords = isAtBottom($event.currentTarget)">
          <strong class="text-label-medium">You<span v-if="heldTranscript && voice.listening.value && !microphoneMuted"> · Hearing…</span><span v-else-if="pendingTranscript && !sending"> · Not sent</span></strong>
          <p class="assistant-voice__caption-text text-body-medium">{{ voiceWords }}</p>
        </section>
        <section ref="voiceAnswerTarget" class="assistant-voice__caption" :aria-label="`${targetLabel} latest answer`" tabindex="0" @scroll="followAnswer = isAtBottom($event.currentTarget)">
          <strong class="text-label-medium">{{ targetLabel }}</strong>
          <p class="assistant-voice__caption-text text-body-medium">{{ voiceAnswer }}</p>
        </section>
      </div>
      <section v-if="pendingTranscript && (pendingTranscript.reviewBeforeSend || !sending)" class="assistant-voice__review" aria-label="Review voice message">
        <v-textarea :model-value="pendingTranscript.text" label="Review your message" :disabled="sending" rows="2" max-rows="3" auto-grow hide-details @update:model-value="editTranscript" />
        <div class="assistant-voice__review-actions">
          <v-btn :disabled="sending" min-height="48" @click="discardHeldRecording">Discard</v-btn>
          <v-btn :disabled="sending || !pendingTranscript.text.trim()" min-height="48" color="primary" @click="deliverTranscript">{{ sending ? 'Sending…' : 'Send' }}</v-btn>
        </div>
      </section>
      <div class="assistant-voice__talk-action">
        <v-btn
          class="assistant-voice__talk" color="primary" :variant="handsFreeListening ? 'tonal' : 'flat'" min-height="64" rounded="xl"
          :prepend-icon="voice.listening.value && !microphoneMuted ? mdiMicrophone : mdiMicrophoneOff" :aria-pressed="handsFreeListening || pushHolding" :aria-describedby="gestureHint"
          :disabled="!canTalk"
          @pointerdown="gesture.pointerDown" @pointerup="gesture.pointerUp" @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel"
          @keydown.space.prevent="gesture.keyDown" @keyup.space.prevent="gesture.keyUp"
          @keydown.enter.prevent="gesture.keyDown" @keyup.enter.prevent="gesture.keyUp" @blur="gesture.cancel" @contextmenu.prevent @click="gesture.click"
        >
          {{ talkLabel }}
        </v-btn>
        <v-btn
          :icon="readAloud ? mdiVolumeHigh : mdiVolumeOff" :aria-pressed="readAloud" variant="tonal" min-height="64" min-width="64" rounded="xl"
          :aria-label="readAloud ? `Turn ${targetLabel} read-aloud off` : `Read ${targetLabel} answers aloud`"
          :title="readAloud ? 'Spoken replies on' : 'Spoken replies off'" @click="toggleReadAloud"
        />
        <p :id="gestureHint" class="text-body-small text-medium-emphasis">{{ handsFreeListening ? 'Tap to pause · hold to speak' : 'Tap for hands-free · hold to speak' }}</p>
      </div>
    </section>
  </fieldset>
</template>

<style scoped>
.assistant-voice { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; border: 0; padding: 0; margin: 0; min-width: 0; }
.assistant-voice__call { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) minmax(144px, 30%) auto; }
.assistant-voice__call-body { min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 16px 0; text-align: center; }
.assistant-voice__call-portrait { position: relative; height: min(240px, calc(100% - 64px)); aspect-ratio: 1; max-width: 100%; margin: 8px auto; isolation: isolate; }
.assistant-voice__call-portrait::before { content: ''; position: absolute; inset: -12px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); transform: scale(var(--call-audio-scale)); transition: transform 80ms linear; z-index: -1; }
.assistant-voice__call-portrait :deep(svg) { width: 100%; height: 100%; }
.assistant-voice__call-status-row { display: flex; flex: 0 0 48px; justify-content: center; align-items: center; gap: 8px; height: 48px; }
.assistant-voice__call-status-row p { margin: 0; max-height: 48px; overflow: hidden; }
.assistant-voice__captions { min-height: 0; display: grid; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 16px; }
.assistant-voice__caption { min-height: 0; padding: 8px 12px; border-radius: 12px; background: rgba(var(--v-theme-on-surface), .04); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; touch-action: pan-y; }
.assistant-voice__caption > strong { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.assistant-voice__caption-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant-voice__talk-action { justify-self: center; width: min(288px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) 64px; gap: 6px 8px; padding: 16px; }
.assistant-voice__talk { touch-action: none; user-select: none; -webkit-touch-callout: none; }
.assistant-voice__talk-action p { grid-column: 1 / -1; margin: 0; text-align: center; white-space: nowrap; }
.assistant-voice__review { flex: 0 0 auto; max-height: 160px; overflow-y: auto; padding: 8px 16px; }
.assistant-voice__review-actions { display: flex; justify-content: flex-end; gap: 8px; }
.assistant-voice__error { padding: 8px 16px; color: rgb(var(--v-theme-error)); }
@media (max-height: 650px) {
  .assistant-voice__call-body { padding-top: 0; }
  .assistant-voice__captions { gap: 4px; }
  .assistant-voice__caption { padding-block: 4px; }
  .assistant-voice__talk-action { padding-top: 8px; }
}
@media (prefers-reduced-motion: reduce) { .assistant-voice__call-portrait::before { transition: none; transform: none; } }
</style>
