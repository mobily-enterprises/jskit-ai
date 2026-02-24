<template>
  <v-skeleton-loader :type="skeletonType" aria-hidden="true" />
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  variant: {
    type: String,
    default: "detail"
  }
});

const skeletonType = computed(() => {
  const variant = String(props.variant || "")
    .trim()
    .toLowerCase();
  if (variant === "table") {
    return "text@2, list-item-two-line@7";
  }
  if (variant === "form") {
    return "text@2, paragraph, paragraph, button";
  }
  return "text@2, paragraph";
});
</script>
