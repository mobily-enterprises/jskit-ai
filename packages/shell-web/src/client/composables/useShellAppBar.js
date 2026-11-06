import { onBeforeUnmount, onMounted, provide } from "vue";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";
import { SHELL_PAGE_ACTIONS_ID, SHELL_PAGE_ACTIONS_TARGET_KEY } from "../support/navigationPresentation.js";

/**
 * Makes the calling layout the owner of the shell's top app bar: the pages it renders enter the navigation trail, so
 * Up returns to where a page was opened from, and their ShellPageActions show in its ShellPageActionsTarget.
 * ShellLayout calls it. A layout that draws its own top app bar calls it once and renders ShellUpButton,
 * ShellPageTitle and ShellPageActionsTarget in that bar.
 */
function useShellAppBar() {
  const navigationRuntime = useShellNavigationRuntime();
  let release = null;

  provide(SHELL_PAGE_ACTIONS_TARGET_KEY, `#${SHELL_PAGE_ACTIONS_ID}`);

  onMounted(() => {
    release = navigationRuntime.attachShell();
  });

  onBeforeUnmount(() => {
    release?.();
    release = null;
  });
}

export { useShellAppBar };
