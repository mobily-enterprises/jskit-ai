import {
  inject,
  onBeforeUnmount,
  onMounted,
  shallowRef
} from "vue";

const EMPTY_PRESENTATION_STATE = Object.freeze({
  revision: 0,
  channels: Object.freeze({
    snackbar: Object.freeze([]),
    banner: Object.freeze([]),
    dialog: Object.freeze([])
  })
});

const EMPTY_ERROR_RUNTIME = Object.freeze({
  report() {
    return Object.freeze({
      skipped: true,
      reason: "unavailable"
    });
  },
  dismiss() {
    return 0;
  },
  configure() {
    return Object.freeze({
      presenterIds: Object.freeze([]),
      appDefaultPresenterId: "",
      moduleDefaultPresenterId: "",
      resolvedDefaultPresenterId: ""
    });
  },
  registerPresenter() {
    throw new Error("Shell web error runtime is not available.");
  },
  registerPresenters() {
    throw new Error("Shell web error runtime is not available.");
  },
  setPolicy() {
    throw new Error("Shell web error runtime is not available.");
  },
  setAppDefaultPresenterId() {
    throw new Error("Shell web error runtime is not available.");
  },
  assertBootReady() {
    throw new Error("Shell web error runtime is not available.");
  },
  getSnapshot() {
    return Object.freeze({
      presenterIds: Object.freeze([]),
      appDefaultPresenterId: "",
      moduleDefaultPresenterId: "",
      resolvedDefaultPresenterId: ""
    });
  },
  subscribe() {
    return () => {};
  }
});

const EMPTY_PRESENTATION_STORE = Object.freeze({
  getState() {
    return EMPTY_PRESENTATION_STATE;
  },
  subscribe() {
    return () => {};
  },
  present() {
    throw new Error("Shell web error presentation store is not available.");
  },
  dismiss() {
    return 0;
  },
  clear() {
    return 0;
  }
});

function useShellWebErrorRuntime({ required = false } = {}) {
  const runtime = inject("jskit.shell-web.runtime.web-error.client", null);
  if (runtime && typeof runtime.report === "function") {
    return runtime;
  }

  if (required) {
    throw new Error("Shell web error runtime is not available in Vue injection context.");
  }

  return EMPTY_ERROR_RUNTIME;
}

function useShellWebErrorPresentationStore({ required = false } = {}) {
  const store = inject("jskit.shell-web.runtime.web-error.presentation-store.client", null);
  if (store && typeof store.getState === "function" && typeof store.subscribe === "function") {
    return store;
  }

  if (required) {
    throw new Error("Shell web error presentation store is not available in Vue injection context.");
  }

  return EMPTY_PRESENTATION_STORE;
}

function useShellWebErrorPresentationState({ required = false } = {}) {
  const store = useShellWebErrorPresentationStore({ required });
  const state = shallowRef(store.getState());
  let unsubscribe = null;

  onMounted(() => {
    unsubscribe = store.subscribe((nextState) => {
      state.value = nextState;
    });
  });

  onBeforeUnmount(() => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return Object.freeze({
    state,
    store
  });
}

export {
  EMPTY_ERROR_RUNTIME,
  EMPTY_PRESENTATION_STORE,
  EMPTY_PRESENTATION_STATE,
  useShellWebErrorRuntime,
  useShellWebErrorPresentationStore,
  useShellWebErrorPresentationState
};
