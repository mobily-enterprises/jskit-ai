<script setup>
import { computed } from "vue";
import { mdiAccountCogOutline, mdiCogOutline, mdiLogin, mdiLogout } from "@mdi/js";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

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
const { context: placementContext } = useWebPlacementContext();

const resolvedNavigationTarget = computed(() => {
  const target = String(props.to || "").trim();
  if (!target) {
    return {
      href: "",
      sameOrigin: true
    };
  }

  const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
    path: target
  });
  return {
    href: navigationTarget.href,
    sameOrigin: navigationTarget.sameOrigin
  };
});

const resolvedIcon = computed(() => {
  const explicitIcon = String(props.icon || "").trim();
  if (explicitIcon) {
    return explicitIcon;
  }

  const normalizedLabel = String(props.label || "").trim().toLowerCase();
  const normalizedTarget = String(props.to || "").trim().toLowerCase();
  if (
    normalizedLabel.includes("sign in") ||
    normalizedTarget.includes("/auth/login")
  ) {
    return mdiLogin;
  }

  if (
    normalizedLabel.includes("sign out") ||
    normalizedTarget.includes("/auth/signout")
  ) {
    return mdiLogout;
  }

  if (normalizedLabel.includes("settings") || normalizedTarget.includes("/settings")) {
    if (normalizedTarget.includes("/account/settings")) {
      return mdiAccountCogOutline;
    }
    return mdiCogOutline;
  }

  return "";
});
</script>

<template>
  <v-list-item
    :title="props.label || undefined"
    :to="resolvedNavigationTarget.sameOrigin ? resolvedNavigationTarget.href || undefined : undefined"
    :href="resolvedNavigationTarget.sameOrigin ? undefined : resolvedNavigationTarget.href || undefined"
    :prepend-icon="resolvedIcon || undefined"
  />
</template>
