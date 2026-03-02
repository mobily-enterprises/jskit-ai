import { computed, onMounted, ref } from "vue";
import { performSignOutRequest } from "../runtime/useSignOut.js";

function normalizeReturnToPath(rawValue, fallback = "/app") {
  const normalized = String(rawValue || "").trim();
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  if (normalized === "/auth/login" || normalized.startsWith("/auth/login?")) {
    return fallback;
  }
  if (normalized === "/auth/signout" || normalized.startsWith("/auth/signout?")) {
    return fallback;
  }
  return normalized;
}

function readReturnToPathFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return "/app";
  }
  const params = new URLSearchParams(window.location.search || "");
  return normalizeReturnToPath(params.get("returnTo"), "/app");
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
  const status = ref("pending");
  const errorMessage = ref("");
  const returnToPath = ref("/app");

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
    errorMessage.value = "";

    try {
      await performSignOutRequest();
      status.value = "success";
      navigateToPath(loginRoute.value, { replace: true });
    } catch (error) {
      status.value = "error";
      errorMessage.value = String(error?.message || "Sign out failed.");
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
