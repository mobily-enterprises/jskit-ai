import { computed, toValue } from "vue";
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import {
  useWebPlacementContext,
  useWebPlacementRevision,
  useWebPlacementRuntime
} from "../placement/inject.js";
import { resolveRuntimePathname } from "../placement/pathname.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import { resolveShellLayoutClass } from "../support/shellLayoutClass.js";

/**
 * The placements an outlet renders on the current surface and window size class: ShellOutlet draws them, and
 * ShellLayout checks which navigation outlets have any.
 * @param {import("vue").MaybeRefOrGetter<string>} target
 * @param {import("vue").MaybeRefOrGetter<Record<string, unknown>>} [context]
 */
function useShellOutletPlacements(target, context = {}) {
  const route = useRoute();
  const display = useDisplay();
  const placementRuntime = useWebPlacementRuntime();
  const { context: placementContext } = useWebPlacementContext();
  const revision = useWebPlacementRevision(placementRuntime);

  const surface = computed(() => {
    const contextValue = placementContext.value;
    const surfaceFromPathname = resolveSurfaceIdFromPlacementPathname(contextValue, resolveRuntimePathname(route.path));
    if (surfaceFromPathname) {
      return surfaceFromPathname;
    }
    return readPlacementSurfaceConfig(contextValue).defaultSurfaceId || "*";
  });

  return computed(() => {
    void revision.value;
    return placementRuntime.getPlacements({
      surface: surface.value,
      target: String(toValue(target) || "").trim(),
      layoutClass: resolveShellLayoutClass(display.width.value),
      context: toValue(context)
    });
  });
}

export { useShellOutletPlacements };
