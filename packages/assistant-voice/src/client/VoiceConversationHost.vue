<script setup>
import { mdiHeadset, mdiStop } from "@mdi/js";
import ConversationDialog from "./ConversationDialog.vue";
import VoiceConversation from "./VoiceConversation.vue";
import VoiceConversationSettings from "./VoiceConversationSettings.vue";

const props = defineProps({
  controller: { type: Object, required: true }, activator: { type: Object, default: null },
  avatarSize: { type: String, default: "hidden" },
  presentation: { type: String, default: "dialog", validator: value => ["dialog", "inline"].includes(value) }
});
defineEmits(["update:avatarSize"]);
const state = props.controller.state;
async function invoke(operation) {
  try { await operation(); }
  catch (error) { state.error = error.message; }
}
async function openText() {
  const opening = state.binding.openText();
  props.controller.minimize();
  try { await opening; }
  catch (error) { props.controller.reveal(); throw error; }
}
</script>

<template>
  <ConversationDialog
    v-if="state.session" :model-value="state.visible" :activator="activator" :presentation="presentation"
    :title="state.binding.label || 'Assistant'" mode="talk"
    :show-modes="Boolean(state.binding.openText && !state.binding.adapter)"
    :minimizable="presentation === 'dialog'" close-label="Close voice chat" @minimize="controller.minimize()" @update:model-value="invoke(() => controller.end({ discard: true }))"
    @update:mode="value => value === 'text' && invoke(openText)"
  >
    <template v-if="!state.binding.adapter" #header-actions>
      <VoiceConversationSettings :voice="state.session.voice" @error="state.error = $event.message">
        <template v-if="$slots.settings" #default="settings"><slot name="settings" v-bind="settings" /></template>
      </VoiceConversationSettings>
    </template>
    <v-alert v-if="state.error" type="error" density="compact" role="alert">{{ state.error }}</v-alert>
    <v-alert v-if="state.nextTarget" type="info" class="voice-host__switch">
      Finish or discard your recording for {{ state.binding.label || 'this conversation' }} before switching to {{ state.nextTarget.label || 'another conversation' }}.
      <div class="voice-host__switch-actions">
        <v-btn variant="text" @click="controller.cancelSwitch()">Stay here</v-btn>
        <v-btn :disabled="state.busy || state.session.sending.value" variant="text" @click="invoke(() => controller.switchTarget({ discard: true }))">Discard and switch</v-btn>
        <v-btn v-if="!state.session.hasUnsentSpeech.value" :disabled="state.busy" variant="text" @click="invoke(() => controller.switchTarget())">Switch</v-btn>
      </div>
    </v-alert>
    <div class="voice-host__body">
      <slot name="conversation" :binding="state.binding" :session="state.session" :disabled="state.busy">
        <VoiceConversation
          :key="state.binding.id" :session="state.session" :disabled="state.busy"
          :adapter="state.binding.adapter || null" :show-avatar="state.binding.showAvatar !== false"
          :avatar-size="avatarSize" @update:avatar-size="$emit('update:avatarSize', $event)"
        >
          <template v-if="$slots.avatar" #avatar="visual"><slot name="avatar" v-bind="visual" :binding="state.binding" /></template>
          <template v-if="$slots['avatar-control']" #avatar-control="scope"><slot name="avatar-control" v-bind="scope" :binding="state.binding" :session="state.session" /></template>
          <template v-if="presentation === 'inline' || state.binding.adapter" #settings-control>
            <VoiceConversationSettings :voice="state.session.voice" compact @error="state.error = $event.message">
              <template v-if="$slots.settings" #default="settings"><slot name="settings" v-bind="settings" /></template>
            </VoiceConversationSettings>
          </template>
          <template #work-control>
            <v-btn v-if="state.binding.cancelWork && state.binding.state.status === 'working'" :disabled="state.busy" :icon="mdiStop" variant="text" aria-label="Stop agent work" title="Stop agent work" @click="invoke(state.binding.cancelWork)" />
          </template>
        </VoiceConversation>
      </slot>
    </div>
  </ConversationDialog>
  <template v-if="presentation === 'dialog' && state.session && !state.visible">
    <slot v-if="$slots.reopen" name="reopen" :controller="controller" />
    <v-btn v-else class="voice-host__reopen" color="primary" :prepend-icon="mdiHeadset" min-height="56" @click="controller.reveal()">
      {{ state.binding.label || 'Assistant' }} · Voice chat
    </v-btn>
  </template>
</template>

<style scoped>
.voice-host__body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.voice-host__switch-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.voice-host__switch { flex: 0 0 auto; }
.voice-host__reopen { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); z-index: 1900; }
</style>
