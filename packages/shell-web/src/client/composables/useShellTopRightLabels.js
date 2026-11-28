import { computed, inject } from "vue";
import { NO_SHELL_TOP_RIGHT_LABELS, SHELL_TOP_RIGHT_LABELS_KEY } from "../support/topRightOverflow.js";
import { useShellWindowSizeClass } from "./useShellWindowSizeClass.js";

/**
 * Whether the top app bar's top-right items show their labels, such as an account's name beside its avatar. Without
 * its label an item is a round icon button named by its aria-label. ShellLayout's bar shows them on expanded and large
 * windows only where its title, its page actions and every labelled item fit (useShellTopRightOverflow); a layout's
 * own top-right slot, or a bar ShellLayout does not draw, shows them on expanded and large windows. Compact and medium
 * windows never show them. auth-web's AuthProfileWidget reads it.
 * @returns {{ showsLabels: import("vue").ComputedRef<boolean> }}
 */
function useShellTopRightLabels() {
  /** @type {{ readonly value: boolean | null }} */
  const laidOut = inject(SHELL_TOP_RIGHT_LABELS_KEY, NO_SHELL_TOP_RIGHT_LABELS);
  const { isExpanded, isLarge } = useShellWindowSizeClass();
  return { showsLabels: computed(() => laidOut.value ?? (isExpanded.value || isLarge.value)) };
}

export { useShellTopRightLabels };
