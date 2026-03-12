import { computed } from "vue";
import { useRoute } from "vue-router";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  isWorkspaceVisibility,
  normalizeContactsNamespace,
  normalizeContactsVisibility,
  resolveContactsRelativePath
} from "@jskit-ai/crud/shared/contacts/contactsModuleConfig";
import { contactsResource } from "@jskit-ai/crud/shared/contacts/contactsResource";

function resolveCrudClientConfig(source = {}) {
  const namespace = normalizeContactsNamespace(source?.namespace);
  const visibility = normalizeContactsVisibility(source?.visibility);

  return Object.freeze({
    namespace,
    visibility,
    workspaceScoped: isWorkspaceVisibility(visibility),
    relativePath: resolveContactsRelativePath(namespace)
  });
}

function resolveCrudClientConfigFromPublicConfig() {
  const appConfig = getClientAppConfig();
  return resolveCrudClientConfig(appConfig?.crud);
}

function useCrudClientContext() {
  const route = useRoute();
  const routeContext = useUsersWebWorkspaceRouteContext();
  const crudConfig = resolveCrudClientConfigFromPublicConfig();
  const placementContext = routeContext.placementContext;
  const workspaceSlugFromRoute = computed(() => (crudConfig.workspaceScoped ? routeContext.workspaceSlugFromRoute.value : ""));
  const queryWorkspaceSlug = computed(() => workspaceSlugFromRoute.value);
  const listPath = computed(() =>
    resolveAdminCrudListPath(placementContext.value, workspaceSlugFromRoute.value, crudConfig)
  );
  const createPath = computed(() =>
    resolveAdminCrudNewPath(placementContext.value, workspaceSlugFromRoute.value, crudConfig)
  );

  function listQueryKey(surfaceId = "") {
    return crudListQueryKey(surfaceId, queryWorkspaceSlug.value, crudConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", recordId = 0) {
    return crudViewQueryKey(surfaceId, queryWorkspaceSlug.value, recordId, crudConfig.namespace);
  }

  function resolveViewPath(recordIdLike) {
    return resolveAdminCrudViewPath(recordIdLike, placementContext.value, workspaceSlugFromRoute.value, crudConfig);
  }

  function resolveEditPath(recordIdLike) {
    return resolveAdminCrudEditPath(recordIdLike, placementContext.value, workspaceSlugFromRoute.value, crudConfig);
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

export {
  contactsResource,
  resolveCrudClientConfig,
  resolveCrudClientConfigFromPublicConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId
};
