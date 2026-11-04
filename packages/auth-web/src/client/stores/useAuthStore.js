import { computed, markRaw, shallowRef } from "vue";
import { defineStore } from "pinia";
import { NO_AUTH_GUARD_RUNTIME, NO_AUTH_GUARD_STATE } from "../runtime/inject.js";

function normalizeAuthStateValue(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return NO_AUTH_GUARD_STATE;
  }

  return nextState;
}

function stopListening() {}

export const useAuthStore = defineStore("jskit.auth-web.auth", () => {
  const runtime = shallowRef(markRaw(NO_AUTH_GUARD_RUNTIME));
  const authState = shallowRef(NO_AUTH_GUARD_STATE);
  let unsubscribe = stopListening;

  function setAuthState(nextState) {
    authState.value = normalizeAuthStateValue(nextState);
    return authState.value;
  }

  function detachRuntimeSubscription() {
    unsubscribe();
    unsubscribe = stopListening;
  }

  /** @param {import("../types.js").AuthGuardRuntime} nextRuntime */
  function attachRuntime(nextRuntime) {
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
  const oauthProviders = computed(() => authState.value.oauthProviders || NO_AUTH_GUARD_STATE.oauthProviders);
  const oauthDefaultProvider = computed(() => String(authState.value.oauthDefaultProvider || ""));
  const authCapabilities = computed(() => authState.value.authCapabilities || NO_AUTH_GUARD_STATE.authCapabilities);

  return {
    runtime,
    authState,
    authenticated,
    username,
    oauthProviders,
    oauthDefaultProvider,
    authCapabilities,
    attachRuntime,
    initialize,
    refresh,
    getState,
    subscribe
  };
});
