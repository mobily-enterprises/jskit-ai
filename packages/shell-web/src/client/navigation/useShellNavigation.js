import { computed, inject } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SHELL_NAVIGATION_RUNTIME_KEY, resolvePageParent } from "./shellNavigationRuntime.js";
import { usePaths } from "./usePaths.js";

function resolvedNothing() {
  return Promise.resolve();
}

function releaseNothing() {}

/**
 * The navigation of an application without shell-web's provider: no trail, so Up goes to the declared parent through
 * the router and finishing a page replaces it with its target.
 * @type {any}
 */
const NO_SHELL_NAVIGATION_RUNTIME = Object.freeze({
  trail: Object.freeze({ value: Object.freeze([]) }),
  pageTitleSource: Object.freeze({ value: null }),
  pageClose: Object.freeze({ value: null }),
  visibleParentPanes: Object.freeze({ value: 0 }),
  up: resolvedNothing,
  finish: resolvedNothing,
  pageUnavailable: () => false,
  setPageTitle: () => releaseNothing,
  setPageClose: () => releaseNothing,
  showParentPane: () => releaseNothing,
  attachShell: () => releaseNothing
});

/**
 * The shell's navigation runtime, or `NO_SHELL_NAVIGATION_RUNTIME` in an application without shell-web's provider.
 * @returns {ReturnType<typeof import("./shellNavigationRuntime.js").createShellNavigationRuntime>}
 */
function useShellNavigationRuntime() {
  return inject(SHELL_NAVIGATION_RUNTIME_KEY, NO_SHELL_NAVIGATION_RUNTIME);
}

/**
 * The current page's Up navigation and the Save/Cancel exit of new and edit pages.
 * `canGoUp` is true on an inner page (one that declares `meta.jskit.parent`) unless its parent is visible beside it;
 * `up()` is what the shell's arrow does; `finish(target)` leaves a finished form by replacing its entry, to `target`
 * (Save) or, with no target, back to where it was opened from (Cancel); `pageUnavailable()` tells the shell a page Up
 * returned to has lost its record.
 */
function useShellNavigation() {
  const runtime = useShellNavigationRuntime();
  const withoutShell = runtime === NO_SHELL_NAVIGATION_RUNTIME;
  const router = useRouter();
  const route = useRoute();
  const paths = usePaths();
  const parent = computed(() => resolvePageParent(route.matched));
  const parentTarget = computed(() => {
    if (!parent.value) {
      return "";
    }
    try {
      return paths.page(parent.value.path, { surface: parent.value.surface });
    } catch {
      // A parent whose params the current route lacks falls back to its surface's root.
      return paths.page("/", { surface: parent.value.surface });
    }
  });
  const canGoUp = computed(() => Boolean(parent.value) && runtime.visibleParentPanes.value === 0);
  const upTarget = computed(() => runtime.trail.value.at(-1)?.path || parentTarget.value);

  function up() {
    if (withoutShell) {
      return parentTarget.value ? router.push(parentTarget.value) : resolvedNothing();
    }
    return runtime.up(parentTarget.value);
  }

  /** @param {import("vue-router").RouteLocationRaw} [target] */
  function finish(target = "") {
    if (withoutShell) {
      const destination = target || parentTarget.value;
      return destination ? router.replace(destination) : resolvedNothing();
    }
    return runtime.finish(target, parentTarget.value);
  }

  function pageUnavailable() {
    return runtime.pageUnavailable();
  }

  return {
    canGoUp,
    upTarget,
    up,
    finish,
    pageUnavailable
  };
}

export { NO_SHELL_NAVIGATION_RUNTIME, useShellNavigation, useShellNavigationRuntime };
