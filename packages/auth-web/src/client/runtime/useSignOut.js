import { runAuthSignOutFlow } from "@jskit-ai/auth-core/client/signOutFlow";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authHttpRequest, clearAuthCsrfTokenCache } from "./authHttpClient.js";
import { useRequiredAuthGuardRuntime } from "./inject.js";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";
import { useJskitText } from "../i18n.js";

const SIGN_OUT_ENDPOINT = AUTH_PATHS.LOGOUT;
const SESSION_ENDPOINT = AUTH_PATHS.SESSION;

async function readSessionState() {
  try {
    const payload = await authHttpRequest(SESSION_ENDPOINT, { method: "GET" });
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

async function waitForSignedOutState({ attempts = 4, delayMs = 120 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const session = await readSessionState();
    if (!session?.authenticated) {
      return true;
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

function createHttpLogoutApi() {
  async function logout() {
    const initialSession = await readSessionState();
    const wasAuthenticated = Boolean(initialSession?.authenticated);
    await authHttpRequest(SIGN_OUT_ENDPOINT, { method: "POST" });

    const signedOut = await waitForSignedOutState();
    if (signedOut) {
      return;
    }

    if (!wasAuthenticated) {
      return;
    }

    throw new Error(useJskitText().t("jskit.auth.signOut.serverSessionActive"));
  }

  return Object.freeze({
    logout
  });
}

/** @param {{ authGuardRuntime: import("../types.js").AuthGuardRuntime }} options */
async function performSignOutRequest({ authGuardRuntime }) {
  await runAuthSignOutFlow({
    authApi: createHttpLogoutApi(),
    clearCsrfTokenCache: clearAuthCsrfTokenCache
  });

  const guardState = await authGuardRuntime.refresh();
  if (guardState?.authenticated) {
    throw new Error(useJskitText().t("jskit.auth.signOut.sessionStillActive"));
  }

  return guardState;
}

function noReturnToPath() {
  return "";
}

/**
 * @param {{
 *   currentSurface?: import("vue").Ref<string>,
 *   goToEntry: (target: { resolvedRoute: string }) => unknown,
 *   authGuardRuntime: import("../types.js").AuthGuardRuntime,
 *   returnTo?: string,
 *   resolveReturnToPath?: () => string
 * }} options
 */
function createSignOutAction({ currentSurface, goToEntry, authGuardRuntime, returnTo = "", resolveReturnToPath = noReturnToPath }) {
  return async function signOut() {
    const resolvedByCallback = normalizeAuthReturnToPath(resolveReturnToPath(), "");
    const resolvedByOption = normalizeAuthReturnToPath(returnTo, "");
    const resolvedByCurrentSurface = normalizeAuthReturnToPath(currentSurface?.value, "");
    const resolvedReturnToPath = resolvedByCallback || resolvedByOption || resolvedByCurrentSurface || "/";
    const redirectParams = new URLSearchParams({
      returnTo: resolvedReturnToPath
    });
    const redirectRoute = `/auth/login?${redirectParams.toString()}`;

    try {
      await performSignOutRequest({
        authGuardRuntime
      });
      await goToEntry({ resolvedRoute: redirectRoute });
    } catch (error) {
      if (import.meta.env?.DEV) {
        console.error("Sign out request failed.", error);
      }
    }
  };
}

/**
 * @param {{
 *   currentSurface?: import("vue").Ref<string>,
 *   goToEntry: (target: { resolvedRoute: string }) => unknown,
 *   authGuardRuntime?: import("../types.js").AuthGuardRuntime,
 *   returnTo?: string,
 *   resolveReturnToPath?: () => string
 * }} options
 */
function useSignOut({ currentSurface, goToEntry, authGuardRuntime = useRequiredAuthGuardRuntime(), returnTo, resolveReturnToPath }) {
  return {
    signOut: createSignOutAction({
      currentSurface,
      goToEntry,
      authGuardRuntime,
      returnTo,
      resolveReturnToPath
    })
  };
}

export { useSignOut, createSignOutAction, performSignOutRequest };
