import { computed } from "vue";
import { useRoute } from "vue-router";
import { useUsersPaths } from "@jskit-ai/users-web/client/composables/useUsersPaths";
import {
  DEFAULT_CRUD_VISIBILITY,
  resolveCrudClientConfig,
  formatDateTime,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
} from "./crudClientSupportHelpers.js";

function useCrudClientContext(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);
  const paths = useUsersPaths();
  const route = useRoute();
  const workspaceSlugToken = computed(() => paths.workspaceSlug.value);
  const listPath = computed(() => paths.page(crudConfig.relativePath));
  const createPath = computed(() => paths.page(`${crudConfig.relativePath}/new`));

  function listQueryKey(surfaceId = "") {
    const normalizedSurfaceId = String(surfaceId || paths.currentSurfaceId.value || "").trim();
    return crudListQueryKey(normalizedSurfaceId, workspaceSlugToken.value, crudConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", recordId = 0) {
    const normalizedSurfaceId = String(surfaceId || paths.currentSurfaceId.value || "").trim();
    return crudViewQueryKey(normalizedSurfaceId, workspaceSlugToken.value, recordId, crudConfig.namespace);
  }

  function resolveViewPath(recordIdLike) {
    const recordId = toRouteRecordId(recordIdLike);
    if (!recordId) {
      return "";
    }

    return paths.page(`${crudConfig.relativePath}/${recordId}`);
  }

  function resolveEditPath(recordIdLike) {
    const recordId = toRouteRecordId(recordIdLike);
    if (!recordId) {
      return "";
    }

    return paths.page(`${crudConfig.relativePath}/${recordId}/edit`);
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
    useCrudClientContext() {
      return useCrudClientContext(crudConfig);
    },
    toRouteRecordId
  });
}

export {
  DEFAULT_CRUD_VISIBILITY,
  resolveCrudClientConfig,
  formatDateTime,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId,
  useCrudClientContext,
  createCrudClientSupport
};
