import {
  inject
} from "vue";

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

export {
  EMPTY_ERROR_RUNTIME,
  useShellWebErrorRuntime
};
