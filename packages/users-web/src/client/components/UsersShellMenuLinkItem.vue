<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

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

  return `${target}${target.includes("?") ? "&" : "?"}${queryParams.toString()}`;
});
</script>

<template>
  <v-list-item
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
    :disabled="props.disabled"
  />
</template>
