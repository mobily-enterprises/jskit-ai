import {
  inject,
  onBeforeUnmount,
  onMounted,
  shallowRef
} from "vue";

const EMPTY_WEB_PLACEMENT_RUNTIME = Object.freeze({
  getContext() {
    return Object.freeze({});
  },
  getPlacements() {
    return Object.freeze([]);
  },
  setContext() {
    return Object.freeze({});
  },
  subscribe() {
    return () => {};
  },
  getRevision() {
    return 0;
  }
});

const EMPTY_WEB_PLACEMENT_CONTEXT_REF = shallowRef(Object.freeze({}));

const EMPTY_WEB_PLACEMENT_CONTEXT = Object.freeze({
  context: EMPTY_WEB_PLACEMENT_CONTEXT_REF,
  mergeContext() {
    return EMPTY_WEB_PLACEMENT_CONTEXT_REF.value;
  },
  replaceContext() {
    return EMPTY_WEB_PLACEMENT_CONTEXT_REF.value;
  }
});

function useWebPlacementRuntime({ required = false } = {}) {
  const runtime = inject("jskit.shell-web.runtime.web-placement.client", null);
  if (runtime && typeof runtime.getPlacements === "function") {
    return runtime;
  }

  if (required) {
    throw new Error("Web placement runtime is not available in Vue injection context.");
  }

  return EMPTY_WEB_PLACEMENT_RUNTIME;
}

function useWebPlacementContext({ required = false } = {}) {
  const runtime = useWebPlacementRuntime({ required });
  if (runtime === EMPTY_WEB_PLACEMENT_RUNTIME) {
    return EMPTY_WEB_PLACEMENT_CONTEXT;
  }

  const context = shallowRef(runtime.getContext());
  let unsubscribe = null;

  onMounted(() => {
    if (typeof runtime.subscribe !== "function") {
      return;
    }
    unsubscribe = runtime.subscribe(() => {
      context.value = runtime.getContext();
    });
  });

  onBeforeUnmount(() => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
      unsubscribe = null;
    }
  });

  function mergeContext(value = {}, source = "component") {
    context.value = runtime.setContext(value, {
      source
    });
    return context.value;
  }

  function replaceContext(value = {}, source = "component") {
    context.value = runtime.setContext(value, {
      replace: true,
      source
    });
    return context.value;
  }

  return Object.freeze({
    context,
    mergeContext,
    replaceContext
  });
}

export {
  EMPTY_WEB_PLACEMENT_RUNTIME,
  EMPTY_WEB_PLACEMENT_CONTEXT,
  useWebPlacementRuntime,
  useWebPlacementContext
};
