<script setup>
// The speech service's speaking-voice choice. Hosts that replace the settings
// menu content reuse this instead of copying the selector.
const props = defineProps({
  voice: { type: Object, required: true }
});
function selectVoice(value) {
  const selectedVoice = props.voice.selectedVoice;
  selectedVoice.value = value;
}
</script>

<template>
  <v-select
    :model-value="voice.selectedVoice.value" @update:model-value="selectVoice"
    :items="voice.availableVoices.value" item-title="label" item-value="id"
    :disabled="voice.availableVoices.value.length < 2"
    label="Speaking voice" density="comfortable"
    hint="Applies to the next spoken reply" persistent-hint
  />
</template>
