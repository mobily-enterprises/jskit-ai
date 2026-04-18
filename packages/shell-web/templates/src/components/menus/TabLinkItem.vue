<script setup>
import ShellTabLinkItem from "@jskit-ai/shell-web/client/components/ShellTabLinkItem";

const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
    type: String,
    default: ""
  },
  surface: {
    type: String,
    default: ""
  },
  scopedSuffix: {
    type: String,
    default: "/"
  },
  unscopedSuffix: {
    type: String,
    default: "/"
  },
  disabled: {
    type: Boolean,
    default: false
  }
});
</script>

<template>
  <ShellTabLinkItem v-bind="props" />
</template>
