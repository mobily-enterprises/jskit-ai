import { runAuthSignOutFlow } from "@jskit-ai/auth-core/client/signOutFlow";
import { refreshAuthGuardState } from "./authGuardRuntime.js";
import { authHttpRequest, clearAuthCsrfTokenCache } from "./authHttpClient.js";

const SIGN_OUT_ENDPOINTS = Object.freeze(["/api/logout", "/api/v1/logout"]);
const RETRYABLE_STATUS_CODES = new Set([404, 405, 501]);
const SESSION_ENDPOINT = "/api/session";

function statusCodeOf(error) {
  return Number(error?.status || error?.statusCode || 0);
}

function normalizeReturnToPath(value, fallback = "/") {
  const normalized = String(value || "").trim();
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  return normalized;
}

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
      let lastRetryableError = null;
      let lastMaybeSuccessfulError = null;
      let attempted = false;

      for (const endpoint of SIGN_OUT_ENDPOINTS) {
        attempted = true;

        try {
          await authHttpRequest(endpoint, { method: "POST" });
          lastMaybeSuccessfulError = null;
          break;
        } catch (error) {
          const statusCode = statusCodeOf(error);
          if (RETRYABLE_STATUS_CODES.has(statusCode)) {
            lastRetryableError = error;
            continue;
          }
          if (statusCode === 401 || statusCode === 403) {
            lastMaybeSuccessfulError = error;
            break;
          }
          throw error;
        }
      }

      const signedOut = await waitForSignedOutState();
      if (signedOut) {
        return;
      }

      if (!wasAuthenticated) {
        return;
      }

      const statusCode =
        statusCodeOf(lastMaybeSuccessfulError) || statusCodeOf(lastRetryableError) || (attempted ? 0 : 500);
      if (statusCode > 0) {
        throw new Error(`Logout did not terminate the server session (status ${statusCode}).`);
      }

      throw new Error("Logout did not terminate the server session.");
    }
  };
}

async function performSignOutRequest() {
  await runAuthSignOutFlow({
    authApi: createHttpLogoutApi(),
    clearCsrfTokenCache: clearAuthCsrfTokenCache
  });

  const guardState = await refreshAuthGuardState();
  if (guardState?.authenticated) {
    throw new Error("Sign out did not complete because the session is still authenticated.");
  }

  return guardState;
}

function createSignOutAction({ currentSurface, goToEntry, returnTo = "", resolveReturnToPath = null } = {}) {
  if (typeof goToEntry !== "function") {
    throw new TypeError("createSignOutAction requires goToEntry().");
  }

  return async function signOut() {
    const resolvedByCallback =
      typeof resolveReturnToPath === "function" ? normalizeReturnToPath(resolveReturnToPath(), "") : "";
    const resolvedByOption = normalizeReturnToPath(returnTo, "");
    const resolvedByCurrentSurface = normalizeReturnToPath(currentSurface?.value, "");
    const resolvedReturnToPath = resolvedByCallback || resolvedByOption || resolvedByCurrentSurface || "/";
    const redirectParams = new URLSearchParams({
      returnTo: resolvedReturnToPath
    });
    const redirectRoute = `/auth/login?${redirectParams.toString()}`;

    try {
      await performSignOutRequest();
      await goToEntry({ resolvedRoute: redirectRoute });
    } catch (error) {
      if (import.meta.env?.DEV) {
        console.error("Sign out request failed.", error);
      }
    }
  };
}

export { createSignOutAction, performSignOutRequest };
