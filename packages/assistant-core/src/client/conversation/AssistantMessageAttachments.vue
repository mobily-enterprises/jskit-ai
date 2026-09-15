<template>
  <ul
    v-if="attachments.length"
    aria-label="Attached files"
    class="assistant-conversation-attachments"
  >
    <li
      v-for="(attachment, index) in attachments"
      :key="attachmentKey(attachment, index)"
      class="assistant-conversation-attachments__item"
    >
      <component
        :is="previewEnabled ? 'button' : 'span'"
        :type="previewEnabled ? 'button' : undefined"
        class="assistant-conversation-attachments__open"
        @click="previewEnabled && emit('preview', attachment)"
      >
        <v-icon
          aria-hidden="true"
          class="assistant-conversation-attachments__icon"
          :icon="attachmentIcon(attachment)"
          size="19"
        />
        <span class="assistant-conversation-attachments__details">
          <span
            class="assistant-conversation-attachments__name text-body-small font-weight-medium"
            :title="attachment.fileName"
          >
            {{ attachment.reference }} {{ attachment.fileName }}
          </span>
          <span
            v-if="attachmentSizeLabel(attachment.size)"
            class="assistant-conversation-attachments__size text-label-small"
          >
            {{ attachmentSizeLabel(attachment.size) }}
          </span>
        </span>
      </component>
    </li>
  </ul>
</template>

<script setup>
import { mdiFileOutline, mdiImageOutline } from "@mdi/js";
import { attachmentSizeLabel } from "../../shared/conversation/attachments.js";

defineProps({
  attachments: { type: Array, default: () => [] },
  previewEnabled: Boolean
});
const emit = defineEmits(["preview"]);
function attachmentIcon(attachment) {
  return /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/iu.test(attachment.fileName) ? mdiImageOutline : mdiFileOutline;
}
function attachmentKey(attachment, index) {
  return attachment.attachmentId || `${index}:${attachment.fileName}:${attachment.size ?? ""}`;
}
</script>

<style scoped>
.assistant-conversation-attachments {
  display: grid;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  max-width: 100%;
  padding: 0;
  width: min(19rem, 100%);
}

.assistant-conversation-attachments__item {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.82);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 10px;
  color: rgb(var(--v-theme-on-surface));
  min-height: 2.8rem;
  min-width: 0;
  padding: 0.42rem 0.65rem;
}

.assistant-conversation-attachments__icon {
  color: rgb(var(--v-theme-primary));
}

.assistant-conversation-attachments__details {
  display: grid;
  min-width: 0;
}

.assistant-conversation-attachments__open {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  gap: 0.55rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 0;
  text-align: left;
  display: grid;
  min-width: 0;
  width: 100%;
}

.assistant-conversation-attachments__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-conversation-attachments__size {
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
