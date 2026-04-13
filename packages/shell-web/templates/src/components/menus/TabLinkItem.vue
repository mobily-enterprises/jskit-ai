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
  workspaceSuffix: {
    type: String,
    default: "/"
  },
  nonWorkspaceSuffix: {
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
