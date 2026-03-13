import { computed } from "vue";
import { useRoute } from "vue-router";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import { crudResource } from "../shared/crudResource.js";

const CRUD_NAMESPACE = "${option:namespace|snake|default(crud)}";
const CRUD_ROUTE_SEGMENT = "${option:namespace|kebab|default(crud)}";
const CRUD_VISIBILITY = normalizeRouteVisibility("${option:visibility}", {
  fallback: "workspace"
});
const CRUD_RELATIVE_PATH = `/${CRUD_ROUTE_SEGMENT}`;
const CRUD_WORKSPACE_SCOPED = isWorkspaceVisibility(CRUD_VISIBILITY);

const crudClientConfig = Object.freeze({
  namespace: CRUD_NAMESPACE,
  visibility: CRUD_VISIBILITY,
  workspaceScoped: CRUD_WORKSPACE_SCOPED,
  relativePath: CRUD_RELATIVE_PATH
});

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function resolveCrudClientConfig() {
  return crudClientConfig;
}

function useCrudClientContext() {
  const route = useRoute();
  const routeContext = useUsersWebWorkspaceRouteContext();
  const crudConfig = resolveCrudClientConfig();
  const placementContext = routeContext.placementContext;
  const workspaceSlugFromRoute = computed(() => (crudConfig.workspaceScoped ? routeContext.workspaceSlugFromRoute.value : ""));
  const queryWorkspaceSlug = computed(() => workspaceSlugFromRoute.value);
  const listPath = computed(() =>
    resolveAdminCrudListPath(placementContext.value, workspaceSlugFromRoute.value)
  );
  const createPath = computed(() =>
    resolveAdminCrudNewPath(placementContext.value, workspaceSlugFromRoute.value)
  );

  function listQueryKey(surfaceId = "") {
    return crudListQueryKey(surfaceId, queryWorkspaceSlug.value, crudConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", recordId = 0) {
    return crudViewQueryKey(surfaceId, queryWorkspaceSlug.value, recordId, crudConfig.namespace);
  }

  function resolveViewPath(recordIdLike) {
    return resolveAdminCrudViewPath(recordIdLike, placementContext.value, workspaceSlugFromRoute.value);
  }

  function resolveEditPath(recordIdLike) {
    return resolveAdminCrudEditPath(recordIdLike, placementContext.value, workspaceSlugFromRoute.value);
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

function crudListQueryKey(surfaceId = "", workspaceSlug = "", namespace = "") {
  return [
    "crud",
    "crud",
    normalizeQueryToken(namespace),
    "list",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ];
}

function crudViewQueryKey(surfaceId = "", workspaceSlug = "", recordId = 0, namespace = "") {
  return [
    "crud",
    "crud",
    normalizeQueryToken(namespace),
    "view",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    Number(recordId) || 0
  ];
}

function resolveAdminCrudListPath(context = null, workspaceSlug = "") {
  const config = resolveCrudClientConfig();
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: config.relativePath,
    mode: "auto"
  });
}

function resolveAdminCrudNewPath(context = null, workspaceSlug = "") {
  const config = resolveCrudClientConfig();
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/new`,
    mode: "auto"
  });
}

function resolveAdminCrudViewPath(recordIdLike, context = null, workspaceSlug = "") {
  const recordId = Number(recordIdLike);
  if (!Number.isInteger(recordId) || recordId < 1) {
    return "";
  }

  const config = resolveCrudClientConfig();
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/${recordId}`,
    mode: "auto"
  });
}

function resolveAdminCrudEditPath(recordIdLike, context = null, workspaceSlug = "") {
  const recordId = Number(recordIdLike);
  if (!Number.isInteger(recordId) || recordId < 1) {
    return "";
  }

  const config = resolveCrudClientConfig();
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

export {
  crudResource,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId
};
