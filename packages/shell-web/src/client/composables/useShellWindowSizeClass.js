import { computed } from "vue";
import { useDisplay } from "vuetify";
import { resolveWindowSizeClass } from "../support/windowSizeClass.js";

/**
 * The Material 3 window size class of the current window: "compact" (under 600dp), "medium" (600-839), "expanded"
 * (840-1199) or "large" (1200 and wider), with a boolean for each.
 */
function useShellWindowSizeClass() {
  const display = useDisplay();
  const sizeClass = computed(() => resolveWindowSizeClass(display.width.value));
  return {
    sizeClass,
    isCompact: computed(() => sizeClass.value === "compact"),
    isMedium: computed(() => sizeClass.value === "medium"),
    isExpanded: computed(() => sizeClass.value === "expanded"),
    isLarge: computed(() => sizeClass.value === "large")
  };
}

export { useShellWindowSizeClass };
