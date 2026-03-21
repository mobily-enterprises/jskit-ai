<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { isExternalLinkTarget, splitPathQueryHash } from "@jskit-ai/kernel/shared/support/linkPath";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { resolveAccountSettingsPathFromPlacementContext } from "../lib/workspaceSurfacePaths.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";

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

function resolveFallbackReturnTo() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  const pathname = String(window.location.pathname || "").trim() || "/";
  const search = String(window.location.search || "").trim();
  const hash = String(window.location.hash || "").trim();
  return `${pathname}${search}${hash}`;
}

function resolveFallbackReturnToHref() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  return String(window.location.href || "").trim() || resolveFallbackReturnTo();
}

function resolvePathnameFromLinkTarget(target = "") {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return "";
  }

  if (isExternalLinkTarget(normalizedTarget)) {
    try {
      const parsed = new URL(normalizedTarget);
      return String(parsed.pathname || "").trim();
    } catch {
      return "";
    }
  }

  return splitPathQueryHash(normalizedTarget).pathname;
}

const accountSettingsPathname = computed(() => {
  const settingsPath = resolveAccountSettingsPathFromPlacementContext(placementContext.value);
  return resolvePathnameFromLinkTarget(settingsPath);
});

const resolvedTo = computed(() => {
  const target = String(props.to || "").trim();
  if (!target) {
    return "";
  }

  const targetPathname = resolvePathnameFromLinkTarget(target);
  if (!targetPathname || targetPathname !== accountSettingsPathname.value) {
    return target;
  }
  if (target.includes("returnTo=")) {
    return target;
  }

  const accountSettingsTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
    path: target,
    surfaceId: "account"
  });
  const routeFullPath = String(route?.fullPath || "").trim();
  const routePath = String(route?.path || "").trim();
  const returnTo = accountSettingsTarget.sameOrigin
    ? routeFullPath || routePath || resolveFallbackReturnTo()
    : resolveFallbackReturnToHref();
  const queryParams = new URLSearchParams({
    returnTo
  });

  return appendQueryString(target, queryParams.toString());
});

const resolvedNavigationTarget = computed(() => {
  const target = String(resolvedTo.value || "").trim();
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

const resolvedIcon = computed(() =>
  resolveMenuLinkIcon({
    icon: props.icon,
    label: props.label,
    to: resolvedTo.value
  })
);
</script>

<template>
  <v-list-item
    :title="props.label"
    :to="resolvedNavigationTarget.sameOrigin ? resolvedNavigationTarget.href : undefined"
    :href="resolvedNavigationTarget.sameOrigin ? undefined : resolvedNavigationTarget.href"
    :prepend-icon="resolvedIcon || undefined"
    :disabled="props.disabled"
  />
</template>
