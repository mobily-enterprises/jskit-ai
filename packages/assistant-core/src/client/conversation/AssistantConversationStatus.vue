<template>
  <div v-if="message.delivery" class="d-flex flex-wrap align-center ga-1 text-caption text-error" role="status">
    <span>{{ message.delivery.error || message.text }}</span>
    <v-btn
      variant="text"
      color="error"
      size="x-small"
      aria-label="Retry delivery check"
      :disabled="message.delivery.checking"
      @click="$emit('check-delivery', message.delivery.messageId)"
    >
      {{ message.delivery.checking ? 'Checking…' : 'Retry' }}
    </v-btn>
  </div>
  <slot v-else>
    <LongTextPreviewBlocks compact :blocks="message.blocks" @link-click="$emit('link-click', $event)" />
  </slot>
</template>

<script setup>
import LongTextPreviewBlocks from "./LongTextPreviewBlocks.vue";

defineProps({ message: { type: Object, required: true } });
defineEmits(["check-delivery", "link-click"]);
</script>
