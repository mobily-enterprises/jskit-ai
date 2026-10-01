<script setup>
import { mdiCog, mdiHeadset, mdiStop } from "@mdi/js";
import ConversationDialog from "./ConversationDialog.vue";
import VoiceConversation from "./VoiceConversation.vue";

const props = defineProps({ controller: { type: Object, required: true }, activator: { type: Object, default: null } });
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
    v-if="state.session" :model-value="state.visible" :activator="activator" :title="state.binding.label || 'Assistant'" mode="talk" :show-modes="Boolean(state.binding.openText)"
    minimizable close-label="Close voice chat" @minimize="controller.minimize()" @update:model-value="invoke(() => controller.end({ discard: true }))"
    @update:mode="value => value === 'text' && invoke(openText)"
  >
    <template #header-actions>
      <v-menu :close-on-content-click="false" location="bottom end" @update:model-value="open => open && invoke(() => state.session.voice.connect())">
        <template #activator="{ props: settingsButton }">
          <v-btn v-bind="settingsButton" :icon="mdiCog" variant="text" aria-label="Voice settings" title="Voice settings" />
        </template>
        <v-card class="voice-host__settings" role="region" aria-label="Voice settings">
          <v-card-text>
            <v-select
              v-model="state.session.voice.selectedVoice.value"
              :items="state.session.voice.availableVoices.value" item-title="label" item-value="id"
              :disabled="state.session.voice.availableVoices.value.length < 2"
              label="Speaking voice" density="comfortable"
              hint="Applies to the next spoken reply" persistent-hint
            />
          </v-card-text>
        </v-card>
      </v-menu>
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
      <VoiceConversation :key="state.binding.id" :session="state.session" :disabled="state.busy">
        <template v-if="$slots.avatar" #avatar="visual"><slot name="avatar" v-bind="visual" :binding="state.binding" /></template>
        <template #work-control>
          <v-btn v-if="state.binding.cancelWork && state.binding.state.status === 'working'" :disabled="state.busy" :icon="mdiStop" variant="text" aria-label="Stop agent work" title="Stop agent work" @click="invoke(state.binding.cancelWork)" />
        </template>
      </VoiceConversation>
    </div>
  </ConversationDialog>
  <template v-if="state.session && !state.visible">
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
.voice-host__settings { width: 320px; max-width: calc(100vw - 32px); }
.voice-host__reopen { position: fixed; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); z-index: 1900; }
</style>
