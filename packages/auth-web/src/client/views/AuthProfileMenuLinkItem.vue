<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import ShellMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellMenuLinkItem";
import { appendAccountReturnToIfNeeded } from "../lib/profileMenuLinkTarget.js";

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
  },
  disabled: {
    type: Boolean,
    default: false
  }
});
const route = useRoute();
const { context: placementContext } = useWebPlacementContext();

function resolveWindowHref() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  return String(window.location.href || "").trim() || "/";
}

const resolvedTo = computed(() =>
  appendAccountReturnToIfNeeded(props.to, {
    placementContext: placementContext.value,
    currentFullPath: route?.fullPath,
    currentPath: route?.path,
    currentHref: resolveWindowHref()
  })
);
</script>

<template>
  <ShellMenuLinkItem
    :label="props.label"
    :to="resolvedTo"
    :icon="props.icon"
    :disabled="props.disabled"
  />
</template>
