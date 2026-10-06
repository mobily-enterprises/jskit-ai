<script setup>
import { computed, ref, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import VoiceAvatar from "./VoiceAvatar.vue";
import VoiceConversationControls from "./VoiceConversationControls.vue";

const props = defineProps({
  session: { type: Object, required: true }, disabled: { type: Boolean, default: false },
  adapter: { type: Object, default: null },
  showAvatar: { type: Boolean, default: true },
  avatarSize: { type: String, default: "compact" }
});
defineEmits(["update:avatarSize"]);
const { targetLabel, voice, microphoneMuted, heldTranscript, pendingTranscript, sending,
  avatarVisual, callAudioLevel, voiceWords, voiceAnswer } = props.session;
const presentationAdapter = computed(() => props.adapter && ({
  ...props.adapter,
  composer: { ...props.adapter.composer, canSend: props.adapter.composer?.canSend && !props.session.hasUnsentSpeech.value }
}));
const toolsTarget = ref(null);
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
  <fieldset v-if="adapter" class="assistant-voice-conversation" :disabled="disabled">
    <AssistantConversationElement :adapter="presentationAdapter" :avatar-size="avatarSize" @update:avatar-size="$emit('update:avatarSize', $event)">
      <template v-if="showAvatar" #avatar="size">
        <slot name="avatar" v-bind="avatarVisual" :size="size.size" :height="size.height">
          <VoiceAvatar v-bind="avatarVisual" />
        </slot>
      </template>
      <template #composer-tools><div ref="toolsTarget" class="assistant-voice-conversation__tools" /></template>
      <template #composer-feedback>
        <VoiceConversationControls :session="session" :disabled="disabled" compact :tools-target="toolsTarget">
          <template #work-control><slot name="work-control" /></template>
        </VoiceConversationControls>
      </template>
    </AssistantConversationElement>
  </fieldset>
  <fieldset v-else class="assistant-voice" :disabled="disabled">
    <section
      class="assistant-voice__call" :class="{ 'assistant-voice__call--without-avatar': !showAvatar }"
      :aria-label="`${targetLabel} voice chat controls`"
    >
      <div v-if="showAvatar" class="assistant-voice__call-body">
        <div class="assistant-voice__call-portrait" :style="{ '--call-audio-scale': 1 + callAudioLevel * .16 }" aria-hidden="true">
          <slot name="avatar" v-bind="avatarVisual"><VoiceAvatar v-bind="avatarVisual" /></slot>
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
      <VoiceConversationControls :session="session" :disabled="disabled"><template #work-control><slot name="work-control" /></template></VoiceConversationControls>
    </section>
  </fieldset>
</template>

<style scoped>
.assistant-voice-conversation { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; height: 100%; border: 0; padding: 0; margin: 0; }
.assistant-voice-conversation__tools { display: flex; flex-wrap: wrap; gap: 4px; }
.assistant-voice { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; border: 0; padding: 0; margin: 0; min-width: 0; }
.assistant-voice__call { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) minmax(144px, 30%) auto; }
.assistant-voice__call--without-avatar { grid-template-rows: minmax(144px, 1fr) auto; }
.assistant-voice__call-body { min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 16px 0; text-align: center; }
.assistant-voice__call-portrait { position: relative; height: min(240px, calc(100% - 64px)); aspect-ratio: 1; max-width: 100%; margin: 8px auto; isolation: isolate; }
.assistant-voice__call-portrait::before { content: ''; position: absolute; inset: -12px; border-radius: 50%; background: rgba(var(--v-theme-primary), .12); transform: scale(var(--call-audio-scale)); transition: transform 80ms linear; z-index: -1; }
.assistant-voice__call-portrait :deep(svg) { width: 100%; height: 100%; }
.assistant-voice__captions { min-height: 0; display: grid; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 16px; }
.assistant-voice__caption { min-height: 0; padding: 8px 12px; border-radius: 12px; background: rgba(var(--v-theme-on-surface), .04); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; touch-action: pan-y; }
.assistant-voice__caption > strong { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.assistant-voice__caption-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-height: 650px) {
  .assistant-voice__call-body { padding-top: 0; }
  .assistant-voice__captions { gap: 4px; }
  .assistant-voice__caption { padding-block: 4px; }
}
@media (prefers-reduced-motion: reduce) { .assistant-voice__call-portrait::before { transition: none; transform: none; } }
</style>
