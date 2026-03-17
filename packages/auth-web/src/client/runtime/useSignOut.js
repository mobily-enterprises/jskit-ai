import { runAuthSignOutFlow } from "@jskit-ai/auth-core/client/signOutFlow";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { isAuthGuardRuntime } from "./authGuardRuntime.js";
import { authHttpRequest, clearAuthCsrfTokenCache } from "./authHttpClient.js";
import { useAuthGuardRuntime } from "./inject.js";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";

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
  return {
    async logout() {
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

      throw new Error("Logout did not terminate the server session.");
    }
  };
}

async function performSignOutRequest({ authGuardRuntime } = {}) {
  if (!isAuthGuardRuntime(authGuardRuntime)) {
    throw new TypeError("performSignOutRequest requires authGuardRuntime from useAuthGuardRuntime().");
  }

  await runAuthSignOutFlow({
    authApi: createHttpLogoutApi(),
    clearCsrfTokenCache: clearAuthCsrfTokenCache
  });

  const guardState = await authGuardRuntime.refresh();
  if (guardState?.authenticated) {
    throw new Error("Sign out did not complete because the session is still authenticated.");
  }

  return guardState;
}

function createSignOutAction({ currentSurface, goToEntry, authGuardRuntime, returnTo = "", resolveReturnToPath = null } = {}) {
  if (typeof goToEntry !== "function") {
    throw new TypeError("createSignOutAction requires goToEntry().");
  }
  if (!isAuthGuardRuntime(authGuardRuntime)) {
    throw new TypeError("createSignOutAction requires authGuardRuntime from useAuthGuardRuntime().");
  }

  return async function signOut() {
    const resolvedByCallback =
      typeof resolveReturnToPath === "function" ? normalizeAuthReturnToPath(resolveReturnToPath(), "") : "";
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

function useSignOut(options = {}) {
  const authGuardRuntime = isAuthGuardRuntime(options?.authGuardRuntime)
    ? options.authGuardRuntime
    : useAuthGuardRuntime({
        required: true
      });

  return Object.freeze({
    signOut: createSignOutAction({
      ...options,
      authGuardRuntime
    })
  });
}

export { useSignOut, createSignOutAction, performSignOutRequest };
