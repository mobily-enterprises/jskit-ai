import { computed } from "vue";
import { useRoute } from "vue-router";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  DEFAULT_CRUD_VISIBILITY,
  isWorkspaceVisibility,
  resolveCrudClientConfig,
  formatDateTime,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId
} from "./crudClientSupportHelpers.js";

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

  function scopeQueryKey() {
    return crudScopeQueryKey(crudConfig.namespace);
  }

  async function invalidateQueries(queryClient) {
    return invalidateCrudQueries(queryClient, crudConfig.namespace);
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
    scopeQueryKey,
    invalidateQueries,
    formatDateTime,
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
    formatDateTime,
    scopeQueryKey() {
      return crudScopeQueryKey(crudConfig.namespace);
    },
    async invalidateQueries(queryClient) {
      return invalidateCrudQueries(queryClient, crudConfig.namespace);
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
  formatDateTime,
  crudScopeQueryKey,
  invalidateCrudQueries,
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
