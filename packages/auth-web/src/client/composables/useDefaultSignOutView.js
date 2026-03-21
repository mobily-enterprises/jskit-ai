import { computed, onMounted, ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { performSignOutRequest } from "../runtime/useSignOut.js";
import { useAuthGuardRuntime } from "../runtime/inject.js";
import {
  normalizeAuthReturnToPath,
  resolveAllowedReturnToOriginsFromPlacementContext
} from "../lib/returnToPath.js";

function readReturnToPathFromLocation({ allowedOrigins = [] } = {}) {
  if (typeof window !== "object" || !window.location) {
    return "/";
  }
  const params = new URLSearchParams(window.location.search || "");
  return normalizeAuthReturnToPath(params.get("returnTo"), "/", {
    allowedOrigins
  });
}

function navigateToPath(path, { replace = true } = {}) {
  if (typeof window !== "object" || !window.location) {
    return;
  }
  if (replace) {
    window.location.replace(path);
    return;
  }
  window.location.assign(path);
}

export function useDefaultSignOutView() {
  const authGuardRuntime = useAuthGuardRuntime({
    required: true
  });
  const { context: placementContext } = useWebPlacementContext();
  const errorRuntime = useShellWebErrorRuntime();
  const status = ref("pending");
  const errorMessage = ref("");
  const returnToPath = ref("/");
  const allowedReturnToOrigins = computed(() =>
    resolveAllowedReturnToOriginsFromPlacementContext(placementContext.value)
  );

  function setErrorMessage(message, dedupeKey = "") {
    const normalizedMessage = String(message || "").trim();
    errorMessage.value = normalizedMessage;
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: "auth-web.default-signout-view",
      message: normalizedMessage,
      severity: "error",
      channel: "banner",
      dedupeKey: dedupeKey || `auth-web.default-signout-view:error:${normalizedMessage}`,
      dedupeWindowMs: 3000
    });
  }

  const loginRoute = computed(() => {
    const loginTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
      path: "/auth/login",
      surfaceId: "auth"
    });
    const params = new URLSearchParams({
      returnTo: returnToPath.value
    });
    return `${loginTarget.href}?${params.toString()}`;
  });

  function goToLogin() {
    navigateToPath(loginRoute.value, { replace: false });
  }

  async function executeSignOut() {
    status.value = "pending";
    setErrorMessage("");

    try {
      await performSignOutRequest({
        authGuardRuntime
      });
      status.value = "success";
      navigateToPath(loginRoute.value, { replace: true });
    } catch (error) {
      status.value = "error";
      setErrorMessage(String(error?.message || "Sign out failed."));
    }
  }

  function retrySignOut() {
    void executeSignOut();
  }

  onMounted(() => {
    returnToPath.value = readReturnToPathFromLocation({
      allowedOrigins: allowedReturnToOrigins.value
    });
    void executeSignOut();
  });

  return {
    status,
    errorMessage,
    retrySignOut,
    goToLogin
  };
}
