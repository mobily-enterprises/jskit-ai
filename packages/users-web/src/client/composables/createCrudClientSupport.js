import { computed } from "vue";
import { useRoute } from "vue-router";
import { normalizeLowerText, normalizeText, normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";

const DEFAULT_CRUD_VISIBILITY = "workspace";

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function normalizeRelativePath(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "/crud";
  }

  const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "/crud" : normalized;
}

function resolveCrudClientConfig(source = {}) {
  const payload = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const namespace = normalizeLowerText(payload.namespace);
  const visibility = normalizeRouteVisibility(payload.visibility, {
    fallback: DEFAULT_CRUD_VISIBILITY
  });
  const inferredRelativePath = namespace ? `/${namespace}` : "/crud";
  const relativePath = normalizeRelativePath(
    Object.hasOwn(payload, "relativePath") ? payload.relativePath : inferredRelativePath
  );

  return Object.freeze({
    namespace,
    visibility,
    workspaceScoped: isWorkspaceVisibility(visibility),
    relativePath
  });
}

function crudListQueryKey(surfaceId = "", workspaceSlug = "", namespace = "") {
  return Object.freeze([
    "crud",
    "crud",
    normalizeQueryToken(namespace),
    "list",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ]);
}

function crudViewQueryKey(surfaceId = "", workspaceSlug = "", recordId = 0, namespace = "") {
  return Object.freeze([
    "crud",
    "crud",
    normalizeQueryToken(namespace),
    "view",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    Number(recordId) || 0
  ]);
}

function resolveAdminCrudListPath(context = null, workspaceSlug = "", source = {}) {
  const config = resolveCrudClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: config.relativePath,
    mode: "auto"
  });
}

function resolveAdminCrudNewPath(context = null, workspaceSlug = "", source = {}) {
  const config = resolveCrudClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/new`,
    mode: "auto"
  });
}

function resolveAdminCrudViewPath(recordIdLike, context = null, workspaceSlug = "", source = {}) {
  const recordId = Number(recordIdLike);
  if (!Number.isInteger(recordId) || recordId < 1) {
    return "";
  }

  const config = resolveCrudClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/${recordId}`,
    mode: "auto"
  });
}

function resolveAdminCrudEditPath(recordIdLike, context = null, workspaceSlug = "", source = {}) {
  const recordId = Number(recordIdLike);
  if (!Number.isInteger(recordId) || recordId < 1) {
    return "";
  }

  const config = resolveCrudClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/${recordId}/edit`,
    mode: "auto"
  });
}

function toRouteRecordId(value) {
  if (Array.isArray(value)) {
    return toRouteRecordId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function useCrudClientContext(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);
  const route = useRoute();
  const routeContext = useUsersWebWorkspaceRouteContext();
  const placementContext = routeContext.placementContext;
  const workspaceSlugFromRoute = computed(() =>
    crudConfig.workspaceScoped ? routeContext.workspaceSlugFromRoute.value : ""
  );
  const listPath = computed(() =>
    resolveAdminCrudListPath(placementContext.value, workspaceSlugFromRoute.value, crudConfig)
  );
  const createPath = computed(() =>
    resolveAdminCrudNewPath(placementContext.value, workspaceSlugFromRoute.value, crudConfig)
  );

  function listQueryKey(surfaceId = "") {
    return crudListQueryKey(surfaceId, workspaceSlugFromRoute.value, crudConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", recordId = 0) {
    return crudViewQueryKey(surfaceId, workspaceSlugFromRoute.value, recordId, crudConfig.namespace);
  }

  function resolveViewPath(recordIdLike) {
    return resolveAdminCrudViewPath(
      recordIdLike,
      placementContext.value,
      workspaceSlugFromRoute.value,
      crudConfig
    );
  }

  function resolveEditPath(recordIdLike) {
    return resolveAdminCrudEditPath(
      recordIdLike,
      placementContext.value,
      workspaceSlugFromRoute.value,
      crudConfig
    );
  }

  return Object.freeze({
    route,
    crudConfig,
    placementContext,
    workspaceSlugFromRoute,
    listPath,
    createPath,
    listQueryKey,
    viewQueryKey,
    resolveViewPath,
    resolveEditPath
  });
}

function createCrudClientSupport(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);

  return Object.freeze({
    crudConfig,
    useCrudClientContext() {
      return useCrudClientContext(crudConfig);
    },
    crudListQueryKey(surfaceId = "", workspaceSlug = "") {
      return crudListQueryKey(surfaceId, workspaceSlug, crudConfig.namespace);
    },
    crudViewQueryKey(surfaceId = "", workspaceSlug = "", recordId = 0) {
      return crudViewQueryKey(surfaceId, workspaceSlug, recordId, crudConfig.namespace);
    },
    resolveAdminCrudListPath(context = null, workspaceSlug = "") {
      return resolveAdminCrudListPath(context, workspaceSlug, crudConfig);
    },
    resolveAdminCrudNewPath(context = null, workspaceSlug = "") {
      return resolveAdminCrudNewPath(context, workspaceSlug, crudConfig);
    },
    resolveAdminCrudViewPath(recordIdLike, context = null, workspaceSlug = "") {
      return resolveAdminCrudViewPath(recordIdLike, context, workspaceSlug, crudConfig);
    },
    resolveAdminCrudEditPath(recordIdLike, context = null, workspaceSlug = "") {
      return resolveAdminCrudEditPath(recordIdLike, context, workspaceSlug, crudConfig);
    },
    toRouteRecordId
  });
}

export {
  DEFAULT_CRUD_VISIBILITY,
  isWorkspaceVisibility,
  resolveCrudClientConfig,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId,
  useCrudClientContext,
  createCrudClientSupport
};
