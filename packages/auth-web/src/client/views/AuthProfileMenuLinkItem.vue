<script setup>
const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: ""
  }
});
</script>

<template>
  <v-list-item
    :title="props.label || undefined"
    :to="props.to || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
