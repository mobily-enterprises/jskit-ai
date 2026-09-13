import { reactive } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";

const REWARDED_RUNTIME_INJECTION_KEY = Symbol("rewarded.web.runtime");
const REWARDED_CONFIGURATION_REASONS = new Set([
  "rule-not-configured",
  "provider-not-configured"
]);
const REWARDED_NON_BLOCKING_REASONS = new Set([
  "already-unlocked",
  "cooldown-active",
  "daily-limit-reached",
  ...REWARDED_CONFIGURATION_REASONS
]);
const rewardedHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

function createInitialState() {
  return {
    open: false,
    phase: "idle",
    errorMessage: "",
    gateState: null,
    session: null,
    request: null
  };
}

function applyState(target, source) {
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(source, key)) {
      delete target[key];
    }
  }
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function normalizeWorkspaceSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isWellFormedGateState(gateState = null) {
  if (!gateState ||
    typeof gateState !== "object" ||
    typeof gateState.enabled !== "boolean" ||
    typeof gateState.blocked !== "boolean") {
    return false;
  }

  if (gateState.blocked === true) {
    return true;
  }

  const reason = String(gateState.reason || "").trim().toLowerCase();
  return Boolean(gateState.unlock) || REWARDED_NON_BLOCKING_REASONS.has(reason);
}

function buildApiPath(workspaceSlug = "", action = "", query = null) {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  const pathname = `/api/w/${encodeURIComponent(normalizedWorkspaceSlug)}/rewarded/${action}`;
  if (!(query instanceof URLSearchParams) || [...query.keys()].length < 1) {
    return pathname;
  }
  return `${pathname}?${query.toString()}`;
}

function createRewardedRuntime({ launchReward } = {}) {
  if (typeof launchReward !== "function") {
    throw new TypeError("Rewarded runtime requires an explicit launchReward delivery function.");
  }
  const state = reactive(createInitialState());
  let pendingResolve = null;
  let activeGrantPromise = null;

  function resetState() {
    activeGrantPromise = null;
    pendingResolve = null;
    applyState(state, createInitialState());
  }

  function settle(result) {
    const resolver = pendingResolve;
    resetState();
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

async function requestCurrent(input = {}) {
  const params = new URLSearchParams({
    gateKey: String(input.gateKey || "")
  });
  return rewardedHttpClient.request(
    buildApiPath(input.workspaceSlug, "current", params),
    {
        method: "GET"
      }
    );
  }

  async function requestStart(input = {}) {
    return rewardedHttpClient.request(
      buildApiPath(input.workspaceSlug, "start"),
      {
        method: "POST",
        body: {
          gateKey: input.gateKey
        }
      }
    );
  }

  async function requestGrant(input = {}) {
    return rewardedHttpClient.request(
      buildApiPath(input.workspaceSlug, "grant"),
      {
        method: "POST",
        body: {
          sessionId: input.sessionId
        }
      }
    );
  }

  async function requestClose(input = {}) {
    return rewardedHttpClient.request(
      buildApiPath(input.workspaceSlug, "close"),
      {
        method: "POST",
        body: {
          sessionId: input.sessionId
        }
      }
    );
  }

  async function requireUnlock(request = {}) {
    const gateKey = String(request?.gateKey || "").trim();
    const workspaceSlug = normalizeWorkspaceSlug(request?.workspaceSlug);

    if (!gateKey) {
      throw new Error("requireUnlock requires gateKey.");
    }
    if (!workspaceSlug) {
      throw new Error("requireUnlock requires workspaceSlug.");
    }

    const gateState = await requestCurrent({
      gateKey,
      workspaceSlug
    });
    if (!isWellFormedGateState(gateState)) {
      throw new Error("Rewarded gate returned an invalid state.");
    }
    const alreadyUnlocked = gateState?.blocked === false && gateState?.unlock;
    if (!gateState?.enabled || !gateState?.blocked) {
      return {
        granted: Boolean(alreadyUnlocked),
        state: gateState
      };
    }

    if (pendingResolve) {
      throw new Error("A Rewarded gate is already active.");
    }

    applyState(state, {
      open: true,
      phase: "prompt",
      errorMessage: "",
      gateState,
      session: null,
      request: {
        gateKey,
        workspaceSlug
      }
    });

    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  }

  async function beginWatch() {
    if (!state.request || state.phase !== "prompt") {
      return;
    }

    applyState(state, {
      ...state,
      phase: "loading"
    });

    try {
      const startState = await requestStart(state.request);
      if (!startState?.session || !startState?.providerConfig) {
        settle({
          granted: false,
          state: startState
        });
        return;
      }

      applyState(state, {
        ...state,
        gateState: startState,
        session: startState.session,
        errorMessage: ""
      });

      await launchReward({
        providerConfig: startState.providerConfig,
        onReady() {
          applyState(state, {
            ...state,
            phase: "showing-ad"
          });
        },
        async onGranted() {
          activeGrantPromise = requestGrant({
            workspaceSlug: state.request.workspaceSlug,
            sessionId: state.session?.id
          });
          const grantResult = await activeGrantPromise;
          applyState(state, {
            ...state,
            phase: "granted",
            gateState: {
              ...state.gateState,
              ...grantResult,
              blocked: false,
              unlock: grantResult.unlock || null
            }
          });
        },
        async onClosed() {
          if (activeGrantPromise) {
            const grantResult = await activeGrantPromise;
            settle({
              granted: true,
              state: {
                ...state.gateState,
                ...grantResult,
                blocked: false,
                unlock: grantResult.unlock || null
              }
            });
            return;
          }

          const closeResult = await requestClose({
            workspaceSlug: state.request.workspaceSlug,
            sessionId: state.session?.id
          });
          settle({
            granted: false,
            state: {
              ...state.gateState,
              ...closeResult,
              blocked: true
            }
          });
        },
        onUnavailable() {
          applyState(state, {
            ...state,
            phase: "error",
            errorMessage: "No rewarded ad was available right now. Please try again later."
          });
        }
      });
    } catch (error) {
      applyState(state, {
        ...state,
        phase: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function cancelPrompt() {
    if (!state.request) {
      return;
    }

    if (state.session?.id) {
      try {
        await requestClose({
          workspaceSlug: state.request.workspaceSlug,
          sessionId: state.session.id
        });
      } catch {
        // Preserve the original user intent even if cleanup fails.
      }
    }

    settle({
      granted: false,
      state: state.gateState
    });
  }

  async function dismissError() {
    await cancelPrompt();
  }

  return Object.freeze({
    state,
    requireUnlock,
    beginWatch,
    cancelPrompt,
    dismissError
  });
}

export {
  REWARDED_RUNTIME_INJECTION_KEY,
  createRewardedRuntime
};
