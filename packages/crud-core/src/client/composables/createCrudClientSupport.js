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
  toRouteRecordId,
  normalizeCrudRouteParamName,
  resolveCrudRecordPathTemplates,
  resolveCrudRecordPathParams
} from "./crudClientSupportHelpers.js";
import { useCrudRealtimeInvalidation } from "./useCrudRealtimeInvalidation.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeRouteParams(params = {}) {
  const source = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  const normalized = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      continue;
    }

    normalized[key] = normalizedValue;
  }

  return normalized;
}

function normalizePathTemplate(value = "") {
  const normalized = normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return normalized ? `/${normalized}` : "";
}

function resolvePathTemplate(pathTemplate = "", { routeParams = {}, params = {}, context = "resolvePathTemplate" } = {}) {
  const normalizedTemplate = normalizePathTemplate(pathTemplate);
  if (!normalizedTemplate) {
    return "";
  }

  const resolvedParams = {
    ...normalizeRouteParams(routeParams),
    ...normalizeRouteParams(params)
  };
  const missingParams = [];
  const resolvedPath = normalizedTemplate.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, key) => {
    const value = normalizeText(resolvedParams[key]);
    if (!value) {
      missingParams.push(key);
      return `:${key}`;
    }

    return encodeURIComponent(value);
  });

  if (missingParams.length > 0) {
    throw new Error(`${context} missing route parameter(s): ${missingParams.join(", ")}.`);
  }

  return resolvedPath;
}

function useCrudClientContext(source = {}) {
  const crudConfig = resolveCrudClientConfig(source);
  const paths = usePaths();
  const route = useRoute();
  const workspaceSlugToken = computed(() => paths.workspaceSlug.value);
  const defaultRecordIdParam = "recordId";
  const listPathTemplate = crudConfig.relativePath;
  const createPathTemplate = `${crudConfig.relativePath}/new`;
  const defaultRecordPathTemplates = resolveCrudRecordPathTemplates(listPathTemplate, defaultRecordIdParam);

  function resolvePath(pathTemplate = "", params = {}) {
    const resolvedPath = resolvePathTemplate(pathTemplate, {
      routeParams: route.params,
      params,
      context: "useCrudClientContext.resolvePath"
    });
    return resolvedPath ? paths.page(resolvedPath) : "";
  }

  function resolveApiPath(pathTemplate = "", params = {}) {
    const resolvedPath = resolvePathTemplate(pathTemplate, {
      routeParams: route.params,
      params,
      context: "useCrudClientContext.resolveApiPath"
    });
    return resolvedPath ? paths.api(resolvedPath) : "";
  }

  const listPath = computed(() => resolvePath(listPathTemplate));
  const createPath = computed(() => resolvePath(createPathTemplate));

  function resolveRecordPathTemplates(recordIdParam = defaultRecordIdParam) {
    return resolveCrudRecordPathTemplates(listPathTemplate, recordIdParam);
  }

  function resolveRecordParams(recordIdLike = 0, { recordIdParam = defaultRecordIdParam } = {}) {
    return resolveCrudRecordPathParams(recordIdLike, recordIdParam);
  }

  function listQueryKey(surfaceId = "") {
    const normalizedSurfaceId = String(surfaceId || paths.currentSurfaceId.value || "").trim();
    return crudListQueryKey(normalizedSurfaceId, workspaceSlugToken.value, crudConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", recordId = 0) {
    const normalizedSurfaceId = String(surfaceId || paths.currentSurfaceId.value || "").trim();
    return crudViewQueryKey(normalizedSurfaceId, workspaceSlugToken.value, recordId, crudConfig.namespace);
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
    listPathTemplate,
    createPathTemplate,
    defaultRecordIdParam,
    viewPathTemplate: defaultRecordPathTemplates.viewPathTemplate,
    editPathTemplate: defaultRecordPathTemplates.editPathTemplate,
    resolveRecordPathTemplates,
    resolveRecordParams,
    resolvePath,
    resolveApiPath,
    listPath,
    createPath,
    listQueryKey,
    viewQueryKey,
    scopeQueryKey,
    invalidateQueries,
    formatDateTime
  });
}

function useCrudRecordRuntime(source = {}, { recordIdParam = "recordId" } = {}) {
  const normalizedRecordIdParam = normalizeCrudRouteParamName(recordIdParam, {
    context: "useCrudRecordRuntime"
  });
  const crudContext = useCrudClientContext(source);
  useCrudRealtimeInvalidation(crudContext.crudConfig.namespace);
  const router = useRouter();
  const recordPathTemplates = crudContext.resolveRecordPathTemplates(normalizedRecordIdParam);
  const recordId = computed(() => toRouteRecordId(crudContext.route.params[normalizedRecordIdParam]));
  const apiSuffix = computed(() => `${crudContext.crudConfig.apiRelativePath}/${recordId.value}`);
  const viewPath = computed(() =>
    crudContext.resolvePath(
      recordPathTemplates.viewPathTemplate,
      crudContext.resolveRecordParams(recordId.value, { recordIdParam: normalizedRecordIdParam })
    )
  );
  const editPath = computed(() =>
    crudContext.resolvePath(
      recordPathTemplates.editPathTemplate,
      crudContext.resolveRecordParams(recordId.value, { recordIdParam: normalizedRecordIdParam })
    )
  );
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

    const targetRecordId = toRouteRecordId(recordIdLike) || recordId.value;
    const targetPath = crudContext.resolvePath(
      recordPathTemplates.viewPathTemplate,
      crudContext.resolveRecordParams(targetRecordId, { recordIdParam: normalizedRecordIdParam })
    );
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
  const recordPathTemplates = crudContext.resolveRecordPathTemplates();
  const listPath = crudContext.listPath;
  const apiSuffix = crudContext.crudConfig.apiRelativePath;

  function createQueryKey(surfaceId = "") {
    return [...crudContext.listQueryKey(surfaceId), "create"];
  }

  async function invalidateAndGoView(queryClient, recordIdLike) {
    await crudContext.invalidateQueries(queryClient);

    const targetPath = crudContext.resolvePath(
      recordPathTemplates.viewPathTemplate,
      crudContext.resolveRecordParams(recordIdLike)
    );
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
  const apiSuffix = crudContext.crudConfig.apiRelativePath;

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
