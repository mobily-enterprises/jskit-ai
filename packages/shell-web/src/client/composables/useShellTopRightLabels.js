import { computed } from "vue";
import { useShellWindowSizeClass } from "./useShellWindowSizeClass.js";

/**
 * Whether the top app bar's top-right items show their labels, such as an account's name beside its avatar: on
 * expanded and large windows. Without its label an item is a round icon button named by its aria-label, as on medium
 * and compact windows, where the bar's title and actions need the room. auth-web's AuthProfileWidget reads it.
 * @returns {{ showsLabels: import("vue").ComputedRef<boolean> }}
 */
function useShellTopRightLabels() {
  const { isExpanded, isLarge } = useShellWindowSizeClass();
  return { showsLabels: computed(() => isExpanded.value || isLarge.value) };
}

export { useShellTopRightLabels };
