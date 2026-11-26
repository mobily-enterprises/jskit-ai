import { computed, onMounted, ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import {
  useWebPlacementContext,
  resolveAllowedOriginsFromPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { performSignOutRequest } from "../runtime/useSignOut.js";
import { useRequiredAuthGuardRuntime } from "../runtime/inject.js";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";
import { useJskitText } from "../i18n.js";

function readReturnToPathFromLocation({ allowedOrigins = [] } = {}) {
  const params = new URLSearchParams(window.location.search || "");
  return normalizeAuthReturnToPath(params.get("returnTo"), "", {
    allowedOrigins
  });
}

function navigateToPath(path, { replace = true } = {}) {
  if (replace) {
    window.location.replace(path);
    return;
  }
  window.location.assign(path);
}

/**
 * The sign-out page without its look: it signs out on mount (`status` "pending", then "success", which opens sign-in
 * with the page's returnTo, or "error" with `errorMessage`, also reported to the shell's error runtime), and offers
 * `retrySignOut` and `goToLogin`. `DefaultSignOutView` renders it in Material 3; an app with its own design system
 * renders it in its own (`@jskit-ai/auth-web/client/composables/useSignOutView`).
 */
export function useSignOutView() {
  const { serverMessage, t } = useJskitText();
  const authGuardRuntime = useRequiredAuthGuardRuntime();
  const { context: placementContext } = useWebPlacementContext();
  const errorRuntime = useShellWebErrorRuntime();
  const status = ref("pending");
  const errorMessage = ref("");
  // "" sends the browser to sign-in without a returnTo, where the sign-in's own landing applies.
  const returnToPath = ref("");
  const allowedReturnToOrigins = computed(() =>
    resolveAllowedOriginsFromPlacementContext(placementContext.value)
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
    if (!returnToPath.value) {
      return loginTarget.href;
    }
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
      setErrorMessage(serverMessage(error, t("jskit.auth.signOut.failed")));
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
