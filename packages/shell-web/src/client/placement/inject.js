import {
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef
} from "vue";

const SHELL_WEB_PLACEMENT_RUNTIME_KEY = "jskit.shell-web.runtime.web-placement.client";

/**
 * The placement runtime of an application without shell-web's provider: nothing is placed.
 * @type {any}
 */
const NO_WEB_PLACEMENT_RUNTIME = Object.freeze({
  replacePlacements() {},
  replacePlacementTopology() {},
  getPlacements() {
    return Object.freeze([]);
  },
  getContext() {
    return Object.freeze({});
  },
  setContext() {
    return Object.freeze({});
  },
  isContextPending() {
    return false;
  },
  subscribe() {
    return () => {};
  },
  getRevision() {
    return 0;
  }
});

/**
 * The shell's placement runtime, or `NO_WEB_PLACEMENT_RUNTIME` in an application without shell-web's provider.
 * @returns {import("../types.js").WebPlacementRuntime}
 */
function useWebPlacementRuntime() {
  return inject(SHELL_WEB_PLACEMENT_RUNTIME_KEY, NO_WEB_PLACEMENT_RUNTIME);
}

// Runs the listener on every placement change while the component is mounted.
function followWebPlacementRuntime(runtime, listener) {
  let unsubscribe = null;

  onMounted(() => {
    unsubscribe = runtime.subscribe(listener);
  });

  onBeforeUnmount(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });
}

/**
 * The placement context, and its setters. `mergeContext(value, source, { pending: true })` says the source's part of it
 * is still loading, as a session's permissions that arrive after the page opens: a ShellLayout opening meanwhile keeps
 * the page unseen until the source sets its context again without `pending`, so its navigation never arrives under the
 * page. Set it before the layout mounts (in the setup of the component that loads it) and end it on success or failure.
 */
function useWebPlacementContext() {
  const runtime = useWebPlacementRuntime();
  const context = shallowRef(runtime.getContext());

  followWebPlacementRuntime(runtime, () => {
    context.value = runtime.getContext();
  });

  function mergeContext(value = {}, source = "component", { pending = false } = {}) {
    context.value = runtime.setContext(value, {
      source,
      pending
    });
    return context.value;
  }

  function replaceContext(value = {}, source = "component", { pending = false } = {}) {
    context.value = runtime.setContext(value, {
      replace: true,
      source,
      pending
    });
    return context.value;
  }

  return {
    context,
    mergeContext,
    replaceContext
  };
}

/**
 * The runtime's revision, for a computed that must read its placements again when they change.
 * @param {import("../types.js").WebPlacementRuntime} runtime
 */
function useWebPlacementRevision(runtime) {
  const revision = ref(runtime.getRevision());

  followWebPlacementRuntime(runtime, (event) => {
    revision.value = event.revision;
  });

  return revision;
}

export {
  NO_WEB_PLACEMENT_RUNTIME,
  SHELL_WEB_PLACEMENT_RUNTIME_KEY,
  useWebPlacementContext,
  useWebPlacementRevision,
  useWebPlacementRuntime
};
