<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";

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

function resolveFallbackReturnTo() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  const pathname = String(window.location.pathname || "").trim() || "/";
  const search = String(window.location.search || "").trim();
  const hash = String(window.location.hash || "").trim();
  return `${pathname}${search}${hash}`;
}

const resolvedTo = computed(() => {
  const target = String(props.to || "").trim();
  if (!target) {
    return "";
  }
  if (!target.startsWith("/account/settings")) {
    return target;
  }
  if (target.includes("returnTo=")) {
    return target;
  }

  const routeFullPath = String(route?.fullPath || "").trim();
  const routePath = String(route?.path || "").trim();
  const returnTo = routeFullPath || routePath || resolveFallbackReturnTo();
  const queryParams = new URLSearchParams({
    returnTo
  });

  return appendQueryString(target, queryParams.toString());
});
</script>

<template>
  <v-list-item
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="props.icon"
    :disabled="props.disabled"
  />
</template>
