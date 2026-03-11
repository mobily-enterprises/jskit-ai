import { computed, watch, proxyRefs } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix
} from "./scopeHelpers.js";

function useCommand({
  visibility = "workspace",
  apiSuffix = "",
  runPermissions = [],
  writeMethod = "POST",
  placementSource = "users-web.command",
  fallbackRunError = "Unable to complete action.",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  parseInput,
  buildRawPayload,
  buildCommandPayload,
  buildCommandOptions,
  onRunSuccess,
  onRunError,
  messages = {}
} = {}) {
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const routeContext = workspaceScoped ? useUsersWebWorkspaceRouteContext() : useUsersWebSurfaceRouteContext();

  const workspaceSlugFromRoute = workspaceScoped ? routeContext.workspaceSlugFromRoute : computed(() => "");
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));
  const normalizedPermissions = normalizePermissions(runPermissions);

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility,
      model
    });

    if (workspaceScoped) {
      return routeContext.resolveWorkspaceApiPath(suffix);
    }

    return normalizeApiPath(suffix);
  });

  const access = useUsersWebAccess({
    workspaceSlug: workspaceScoped ? workspaceSlugFromRoute : "",
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext: routeContext.mergePlacementContext,
    placementSource: String(placementSource || "users-web.command")
  });

  const canRun = computed(() => {
    if (normalizedPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedPermissions);
  });

  const resource = useUsersWebEndpointResource({
    path: apiPath,
    enabled: false,
    writeMethod,
    fallbackSaveError: fallbackRunError
  });

  const feedback = useUsersWebUiFeedback();
  const fieldBag = useUsersWebFieldErrorBag(fieldErrorKeys);

  const command = useCommandCore({
    model,
    resource,
    canRun,
    fieldBag,
    feedback,
    parseInput,
    buildRawPayload,
    buildCommandPayload,
    buildCommandOptions,
    onRunSuccess,
    onRunError,
    messages: {
      validation: "Fix invalid values and try again.",
      success: "Completed.",
      error: String(fallbackRunError || "Unable to complete action."),
      ...(messages && typeof messages === "object" ? messages : {})
    }
  });

  if (clearOnRouteChange) {
    watch(
      () => routeContext.route.fullPath,
      () => {
        feedback.clear();
        fieldBag.clear();
      }
    );
  }

  const loadError = computed(() => {
    if (workspaceScoped && !hasRouteWorkspaceSlug.value) {
      throw new Error("useCommand requires route.params.workspaceSlug when visibility is workspace/workspace_user.");
    }

    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return "";
  });

  const isLoading = computed(() => Boolean(access.isBootstrapping.value));

  return proxyRefs({
    canRun,
    isLoading,
    loadError,
    isRunning: command.running,
    fieldErrors: command.fieldErrors,
    message: command.message,
    messageType: command.messageType,
    run: command.run,
    resource
  });
}

export { useCommand };
