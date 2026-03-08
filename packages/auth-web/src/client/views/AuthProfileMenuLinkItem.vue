<script setup>
import { onMounted } from "vue";

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

onMounted(() => {
  console.log("[auth-profile-menu-item-debug] mounted", {
    label: props.label,
    to: props.to,
    icon: props.icon
  });
});
</script>

<template>
  <v-list-item
    :title="props.label || undefined"
    :to="props.to || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
