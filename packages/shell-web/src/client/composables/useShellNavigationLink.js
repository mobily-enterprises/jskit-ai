import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "../placement/index.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";
import { resolveMenuLinkHref, resolveMenuLinkTarget } from "../support/menuLinkTarget.js";

const shellNavigationLinkProps = Object.freeze({
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
  },
  exact: {
    type: Boolean,
    default: false
  }
});

// Surface-aware link resolution shared by the shell menu and tab link items.
function useShellNavigationLink(props) {
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();

  const resolvedTo = computed(() => {
    const currentSurfaceId = resolveSurfaceIdFromPlacementPathname(
      placementContext.value,
      String(route?.path || route?.fullPath || "").trim()
    );
    return resolveMenuLinkTarget({
      to: props.to,
      surface: props.surface,
      currentSurfaceId,
      placementContext: placementContext.value,
      scopedSuffix: props.scopedSuffix,
      unscopedSuffix: props.unscopedSuffix,
      routeParams: route.params || {}
    });
  });

  const resolvedTarget = computed(() => resolveMenuLinkHref(placementContext.value, resolvedTo.value));

  const resolvedIcon = computed(() =>
    resolveMenuLinkIcon({
      icon: props.icon,
      label: props.label,
      to: resolvedTarget.value.href || resolvedTo.value
    })
  );

  return {
    resolvedTarget,
    resolvedIcon
  };
}

export {
  shellNavigationLinkProps,
  useShellNavigationLink
};
