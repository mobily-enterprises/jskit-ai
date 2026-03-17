import { computed, onMounted, ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { performSignOutRequest } from "../runtime/useSignOut.js";
import { useAuthGuardRuntime } from "../runtime/inject.js";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";

function readReturnToPathFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return "/";
  }
  const params = new URLSearchParams(window.location.search || "");
  return normalizeAuthReturnToPath(params.get("returnTo"), "/");
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
  const errorRuntime = useShellWebErrorRuntime();
  const status = ref("pending");
  const errorMessage = ref("");
  const returnToPath = ref("/");

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
    const params = new URLSearchParams({
      returnTo: returnToPath.value
    });
    return `/auth/login?${params.toString()}`;
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
    returnToPath.value = readReturnToPathFromLocation();
    void executeSignOut();
  });

  return {
    status,
    errorMessage,
    retrySignOut,
    goToLogin
  };
}
