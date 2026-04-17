import { computed, markRaw, shallowRef } from "vue";
import { defineStore } from "pinia";
import { isAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { EMPTY_AUTH_GUARD_RUNTIME, EMPTY_AUTH_GUARD_STATE } from "../runtime/inject.js";

function normalizeAuthStateValue(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return EMPTY_AUTH_GUARD_STATE;
  }

  return nextState;
}

export const useAuthStore = defineStore("jskit.auth-web.auth", () => {
  const runtime = shallowRef(markRaw(EMPTY_AUTH_GUARD_RUNTIME));
  const authState = shallowRef(EMPTY_AUTH_GUARD_STATE);
  let unsubscribe = null;

  function setAuthState(nextState) {
    authState.value = normalizeAuthStateValue(nextState);
    return authState.value;
  }

  function detachRuntimeSubscription() {
    if (typeof unsubscribe === "function") {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function attachRuntime(nextRuntime = EMPTY_AUTH_GUARD_RUNTIME) {
    if (!isAuthGuardRuntime(nextRuntime) || typeof nextRuntime.subscribe !== "function") {
      throw new TypeError("useAuthStore.attachRuntime requires an auth guard runtime with subscribe().");
    }

    if (runtime.value === nextRuntime) {
      setAuthState(nextRuntime.getState());
      return runtime.value;
    }

    detachRuntimeSubscription();
    runtime.value = markRaw(nextRuntime);
    setAuthState(nextRuntime.getState());
    unsubscribe = nextRuntime.subscribe((nextState) => {
      setAuthState(nextState);
    });

    return runtime.value;
  }

  async function initialize(options = {}) {
    return setAuthState(await runtime.value.initialize(options));
  }

  async function refresh(options = {}) {
    return setAuthState(await runtime.value.refresh(options));
  }

  function getState() {
    return authState.value;
  }

  function subscribe(listener) {
    return runtime.value.subscribe(listener);
  }

  const authenticated = computed(() => authState.value.authenticated === true);
  const username = computed(() => String(authState.value.username || ""));
  const oauthProviders = computed(() => authState.value.oauthProviders || EMPTY_AUTH_GUARD_STATE.oauthProviders);
  const oauthDefaultProvider = computed(() => String(authState.value.oauthDefaultProvider || ""));

  return {
    runtime,
    authState,
    authenticated,
    username,
    oauthProviders,
    oauthDefaultProvider,
    attachRuntime,
    initialize,
    refresh,
    getState,
    subscribe
  };
});
