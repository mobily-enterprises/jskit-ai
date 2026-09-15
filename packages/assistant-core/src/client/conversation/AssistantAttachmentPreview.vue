<template>
  <v-dialog :model-value="Boolean(attachment)" max-width="960" @update:model-value="!$event && emit('close')">
    <v-card v-if="attachment" :title="attachment.fileName">
      <v-card-text>
        <img
          v-if="previewUrl && !imageFailed"
          :key="previewUrl"
          :alt="attachment.fileName"
          class="assistant-attachment-preview"
          :src="previewUrl"
          @error="imageFailed = true"
        >
        <p v-else>Preview is unavailable for this file. You can download it below.</p>
      </v-card-text>
      <v-card-actions>
        <v-btn :href="downloadUrl" :download="attachment.fileName" :prepend-icon="mdiDownload" variant="tonal">Download</v-btn>
        <v-spacer />
        <v-btn @click="emit('close')">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, watch } from "vue";
import { mdiDownload } from "@mdi/js";
const props = defineProps({
  attachment: { type: Object, default: null },
  previewUrl: { type: String, default: "" },
  downloadUrl: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const imageFailed = ref(false);
watch(() => [props.attachment, props.previewUrl], () => { imageFailed.value = false; });
</script>
<style scoped>
.assistant-attachment-preview { display: block; margin: auto; max-height: 70vh; max-width: 100%; object-fit: contain; }
</style>
