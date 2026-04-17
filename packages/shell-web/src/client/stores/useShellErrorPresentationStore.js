import { computed, markRaw, shallowRef } from "vue";
import { defineStore } from "pinia";
import { EMPTY_PRESENTATION_STATE, EMPTY_PRESENTATION_STORE } from "../error/presentationDefaults.js";

function normalizePresentationState(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return EMPTY_PRESENTATION_STATE;
  }

  return nextState;
}

function isPresentationRuntimeStore(value) {
  return Boolean(
    value &&
      typeof value.getState === "function" &&
      typeof value.subscribe === "function" &&
      typeof value.present === "function" &&
      typeof value.dismiss === "function" &&
      typeof value.clear === "function"
  );
}

export const useShellErrorPresentationStore = defineStore("jskit.shell-web.error-presentation", () => {
  const runtimeStore = shallowRef(markRaw(EMPTY_PRESENTATION_STORE));
  const presentationState = shallowRef(EMPTY_PRESENTATION_STATE);
  let unsubscribe = null;

  function setPresentationState(nextState) {
    presentationState.value = normalizePresentationState(nextState);
    return presentationState.value;
  }

  function detachRuntimeStore() {
    if (typeof unsubscribe === "function") {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function attachRuntimeStore(nextRuntimeStore = EMPTY_PRESENTATION_STORE) {
    if (!isPresentationRuntimeStore(nextRuntimeStore)) {
      throw new TypeError("useShellErrorPresentationStore.attachRuntimeStore requires an error presentation store.");
    }

    if (runtimeStore.value === nextRuntimeStore) {
      setPresentationState(nextRuntimeStore.getState());
      return runtimeStore.value;
    }

    detachRuntimeStore();
    runtimeStore.value = markRaw(nextRuntimeStore);
    setPresentationState(nextRuntimeStore.getState());
    unsubscribe = nextRuntimeStore.subscribe((nextState) => {
      setPresentationState(nextState);
    });

    return runtimeStore.value;
  }

  function getState() {
    return presentationState.value;
  }

  function subscribe(listener) {
    return runtimeStore.value.subscribe(listener);
  }

  function present(channel, payload = {}) {
    return runtimeStore.value.present(channel, payload);
  }

  function dismiss(channel, presentationId = "") {
    return runtimeStore.value.dismiss(channel, presentationId);
  }

  function clear(channel = "") {
    return runtimeStore.value.clear(channel);
  }

  const revision = computed(() => Number(presentationState.value.revision || 0));
  const channels = computed(() => presentationState.value.channels || EMPTY_PRESENTATION_STATE.channels);

  return {
    runtimeStore,
    presentationState,
    revision,
    channels,
    attachRuntimeStore,
    getState,
    subscribe,
    present,
    dismiss,
    clear
  };
});
