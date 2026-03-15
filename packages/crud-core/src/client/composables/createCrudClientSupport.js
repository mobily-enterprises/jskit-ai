import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  resolveCrudClientConfig,
  formatDateTime,
  crudScopeQueryKey,
  invalidateCrudQueries,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
} from "./crudClientSupportHelpers.js";
import { useCrudRealtimeInvalidation } from "./useCrudRealtimeInvalidation.js";

function useCrudClientContext(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);
  const paths = usePaths();
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

function normalizeRecordIdParam(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError("useCrudRecordRuntime requires a non-empty recordIdParam.");
  }

  return normalized;
}

function useCrudRecordRuntime(source = {}, { recordIdParam = "recordId" } = {}) {
  const normalizedRecordIdParam = normalizeRecordIdParam(recordIdParam);
  const crudContext = useCrudClientContext(source);
  useCrudRealtimeInvalidation(crudContext.crudConfig.namespace);
  const router = useRouter();
  const recordId = computed(() => toRouteRecordId(crudContext.route.params[normalizedRecordIdParam]));
  const apiSuffix = computed(() => `${crudContext.crudConfig.relativePath}/${recordId.value}`);
  const viewPath = computed(() => crudContext.resolveViewPath(recordId.value));
  const editPath = computed(() => crudContext.resolveEditPath(recordId.value));
  const listPath = crudContext.listPath;

  function viewQueryKey(surfaceId = "") {
    return crudContext.viewQueryKey(surfaceId, recordId.value);
  }

  async function invalidateAndGoList(queryClient) {
    await crudContext.invalidateQueries(queryClient);
    if (listPath.value) {
      await router.push(listPath.value);
    }
  }

  async function invalidateAndGoView(queryClient, recordIdLike = recordId.value) {
    await crudContext.invalidateQueries(queryClient);

    const targetRecordId = toRouteRecordId(recordIdLike);
    const targetPath = crudContext.resolveViewPath(targetRecordId || recordId.value);
    if (targetPath) {
      await router.push(targetPath);
    }
  }

  return Object.freeze({
    crudContext,
    listPath,
    recordId,
    apiSuffix,
    viewPath,
    editPath,
    viewQueryKey,
    invalidateAndGoList,
    invalidateAndGoView
  });
}

function useCrudCreateRuntime(source = {}) {
  const crudContext = useCrudClientContext(source);
  useCrudRealtimeInvalidation(crudContext.crudConfig.namespace);
  const router = useRouter();
  const listPath = crudContext.listPath;
  const apiSuffix = crudContext.crudConfig.relativePath;

  function createQueryKey(surfaceId = "") {
    return [...crudContext.listQueryKey(surfaceId), "create"];
  }

  async function invalidateAndGoView(queryClient, recordIdLike) {
    await crudContext.invalidateQueries(queryClient);

    const targetPath = crudContext.resolveViewPath(recordIdLike);
    if (targetPath) {
      await router.push(targetPath);
    }
  }

  return Object.freeze({
    crudContext,
    listPath,
    apiSuffix,
    createQueryKey,
    invalidateAndGoView
  });
}

function useCrudListRuntime(source = {}) {
  const crudContext = useCrudClientContext(source);
  useCrudRealtimeInvalidation(crudContext.crudConfig.namespace);
  const createPath = crudContext.createPath;
  const apiSuffix = crudContext.crudConfig.relativePath;

  function listQueryKey(surfaceId = "") {
    return crudContext.listQueryKey(surfaceId);
  }

  return Object.freeze({
    crudContext,
    createPath,
    apiSuffix,
    listQueryKey
  });
}

function createCrudClientSupport(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);

  return Object.freeze({
    useCrudClientContext() {
      return useCrudClientContext(crudConfig);
    },
    useCrudListRuntime() {
      return useCrudListRuntime(crudConfig);
    },
    useCrudCreateRuntime() {
      return useCrudCreateRuntime(crudConfig);
    },
    useCrudRecordRuntime(options = {}) {
      return useCrudRecordRuntime(crudConfig, options);
    },
    toRouteRecordId
  });
}

export {
  useCrudClientContext,
  useCrudListRuntime,
  useCrudCreateRuntime,
  useCrudRecordRuntime,
  createCrudClientSupport
};
