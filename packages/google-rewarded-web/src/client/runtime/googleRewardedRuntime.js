import { reactive } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";

const GOOGLE_REWARDED_RUNTIME_INJECTION_KEY = Symbol("google-rewarded.web.runtime");
const GOOGLE_REWARDED_CONFIGURATION_REASONS = new Set([
  "rule-not-configured",
  "provider-not-configured"
]);
const GOOGLE_REWARDED_NON_BLOCKING_REASONS = new Set([
  "already-unlocked",
  "cooldown-active",
  "daily-limit-reached",
  ...GOOGLE_REWARDED_CONFIGURATION_REASONS
]);
const googleRewardedHttpClient = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

let gptLoadPromise = null;
let gptServicesEnabled = false;

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
  return Boolean(gateState.unlock) || GOOGLE_REWARDED_NON_BLOCKING_REASONS.has(reason);
}

function buildApiPath(workspaceSlug = "", action = "", query = null) {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  const pathname = `/api/w/${encodeURIComponent(normalizedWorkspaceSlug)}/google-rewarded/${action}`;
  if (!(query instanceof URLSearchParams) || [...query.keys()].length < 1) {
    return pathname;
  }
  return `${pathname}?${query.toString()}`;
}

async function ensureGooglePublisherTagLoaded() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Google rewarded runtime requires a browser environment.");
  }

  if (window.googletag?.apiReady === true) {
    return window.googletag;
  }
  if (gptLoadPromise) {
    return gptLoadPromise;
  }

  window.googletag ||= { cmd: [] };
  gptLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-jskit-google-rewarded-gpt="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.googletag), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Google Publisher Tag.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    script.dataset.jskitGoogleRewardedGpt = "true";
    script.addEventListener("load", () => resolve(window.googletag), { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load Google Publisher Tag.")), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    gptLoadPromise = null;
    throw error;
  });

  return gptLoadPromise;
}

function launchRewardedSlot({
  adUnitPath = "",
  onReady = null,
  onGranted = null,
  onClosed = null,
  onUnavailable = null
} = {}) {
  return ensureGooglePublisherTagLoaded().then((googletag) =>
    new Promise((resolve, reject) => {
      googletag.cmd.push(() => {
        const pubads = googletag.pubads();
        const rewardedFormat = googletag?.enums?.OutOfPageFormat?.REWARDED;
        if (!rewardedFormat) {
          reject(new Error("Google rewarded ads are not supported by this GPT build."));
          return;
        }

        const slot = googletag.defineOutOfPageSlot(adUnitPath, rewardedFormat);
        if (!slot) {
          Promise.resolve(onUnavailable?.()).finally(() => {
            reject(new Error("Google rewarded ads are not available on this page."));
          });
          return;
        }

        let readySeen = false;
        let settled = false;

        const cleanup = () => {
          if (typeof pubads.removeEventListener === "function") {
            pubads.removeEventListener("rewardedSlotReady", handleReady);
            pubads.removeEventListener("rewardedSlotGranted", handleGranted);
            pubads.removeEventListener("rewardedSlotClosed", handleClosed);
          }
          if (typeof googletag.destroySlots === "function") {
            googletag.destroySlots([slot]);
          }
        };

        const handleReady = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          readySeen = true;
          await Promise.resolve(onReady?.());
          if (typeof event.makeRewardedVisible === "function") {
            event.makeRewardedVisible();
          }
        };

        const handleGranted = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          await Promise.resolve(onGranted?.());
        };

        const handleClosed = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          settled = true;
          cleanup();
          try {
            await Promise.resolve(onClosed?.());
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        pubads.addEventListener("rewardedSlotReady", handleReady);
        pubads.addEventListener("rewardedSlotGranted", handleGranted);
        pubads.addEventListener("rewardedSlotClosed", handleClosed);
        slot.addService(pubads);

        if (!gptServicesEnabled) {
          googletag.enableServices();
          gptServicesEnabled = true;
        }

        googletag.display(slot);
        window.setTimeout(() => {
          if (settled || readySeen) {
            return;
          }
          settled = true;
          cleanup();
          Promise.resolve(onUnavailable?.()).finally(() => {
            reject(new Error("No rewarded ad was available."));
          });
        }, 10000);
      });
    })
  );
}

function createGoogleRewardedRuntime() {
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
  return googleRewardedHttpClient.request(
    buildApiPath(input.workspaceSlug, "current", params),
    {
        method: "GET"
      }
    );
  }

  async function requestStart(input = {}) {
    return googleRewardedHttpClient.request(
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
    return googleRewardedHttpClient.request(
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
    return googleRewardedHttpClient.request(
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
      throw new Error("Google rewarded gate returned an invalid state.");
    }
    const alreadyUnlocked = gateState?.blocked === false && gateState?.unlock;
    if (!gateState?.enabled || !gateState?.blocked) {
      return {
        granted: Boolean(alreadyUnlocked),
        state: gateState
      };
    }

    if (pendingResolve) {
      throw new Error("A Google rewarded gate is already active.");
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
      if (!startState?.session || !startState?.providerConfig?.adUnitPath) {
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

      await launchRewardedSlot({
        adUnitPath: startState.providerConfig.adUnitPath,
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
  GOOGLE_REWARDED_RUNTIME_INJECTION_KEY,
  createGoogleRewardedRuntime
};
