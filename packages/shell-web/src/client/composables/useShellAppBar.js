import { onBeforeUnmount, onMounted, provide } from "vue";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";
import { SHELL_PAGE_ACTIONS_ID, SHELL_PAGE_ACTIONS_TARGET_KEY } from "../support/navigationPresentation.js";
import { SHELL_PAGE_ACTIONS_REGISTRY_KEY, createShellPageActionsRegistry } from "../support/pageActions.js";
import { useShellWindowSizeClass } from "./useShellWindowSizeClass.js";

/**
 * Makes the calling layout the owner of the shell's top app bar: the pages it renders enter the navigation trail, so
 * Up returns to where a page was opened from, and their ShellPageActions show in its ShellPageActionsTarget, with
 * the bar's overflow menu for the actions that go there.
 * ShellLayout calls it. A layout that draws its own top app bar calls it once and renders ShellUpButton,
 * ShellPageTitle and ShellPageActionsTarget in that bar.
 * @returns {{ pageActions: import("../support/pageActions.js").ShellPageActionsRegistry }} The bar's page actions,
 *   whose `hasPrimary` tells a compact bar whether its one trailing place is taken.
 */
function useShellAppBar() {
  const navigationRuntime = useShellNavigationRuntime();
  const pageActions = createShellPageActionsRegistry({ isCompact: useShellWindowSizeClass().isCompact });
  let release = null;

  provide(SHELL_PAGE_ACTIONS_TARGET_KEY, `#${SHELL_PAGE_ACTIONS_ID}`);
  provide(SHELL_PAGE_ACTIONS_REGISTRY_KEY, pageActions);

  onMounted(() => {
    release = navigationRuntime.attachShell();
  });

  onBeforeUnmount(() => {
    release?.();
    release = null;
  });

  return { pageActions };
}

export { useShellAppBar };
