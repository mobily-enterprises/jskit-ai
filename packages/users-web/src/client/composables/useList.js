import { computed, onScopeDispose, proxyRefs, ref, watch } from "vue";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudLookupFieldKeys } from "@jskit-ai/kernel/shared/support/crudLookup";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useListCore } from "./useListCore.js";
import { resolveOperationAdapter } from "./operationAdapters.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";
import { createListUiRuntime } from "./listUiRuntime.js";
import {
  normalizeListSearchConfig,
  matchesLocalSearch
} from "./listSearchSupport.js";
import { resolveLookupFieldDisplayValue } from "./crudLookupFieldLabelSupport.js";
import {
  resolveRouteParamNamesInOrder,
  resolveRouteParamsSource,
  toRouteParamValue
} from "./routeTemplateHelpers.js";

function useList({
  ownershipFilter = USERS_ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readEnabled = true,
  placementSource = "users-web.list",
  fallbackLoadError = "Unable to load list.",
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions,
  queryOptions,
  realtime = null,
  adapter = null,
  resource = null,
  recordIdParam = "recordId",
  recordIdSelector = null,
  viewUrlTemplate = "",
  editUrlTemplate = "",
  search = null
} = {}) {
  const searchConfig = normalizeListSearchConfig(search);
  const searchQuery = ref(searchConfig.initialQuery);
  const debouncedSearchQuery = ref(searchConfig.initialQuery);
  let searchDebounceTimer = null;
  const isSearchDebouncing = ref(false);

  watch(searchQuery, (value) => {
    const normalizedValue = normalizeText(value);
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    if (searchConfig.enabled !== true) {
      debouncedSearchQuery.value = normalizedValue;
      isSearchDebouncing.value = false;
      return;
    }
    isSearchDebouncing.value = true;
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchQuery.value = normalizedValue;
      isSearchDebouncing.value = false;
      searchDebounceTimer = null;
    }, searchConfig.debounceMs);
  }, { immediate: true });

  onScopeDispose(() => {
    if (!searchDebounceTimer) {
      return;
    }
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  });

  const operationAdapter = resolveOperationAdapter(adapter, {
    context: "useList adapter"
  });
  const operationScope = operationAdapter.useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
    placementSource,
    apiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    },
    realtime
  });
  const canView = operationScope.permissionGate("view");
  const parentRouteFilter = computed(() => {
    const lookupFieldKeys = resolveCrudLookupFieldKeys(resource);
    if (lookupFieldKeys.length < 1) {
      return null;
    }

    const lookupFieldKeySet = new Set(lookupFieldKeys);
    const sourceRoute = operationScope.routeContext.route;
    const orderedRouteParamNames = resolveRouteParamNamesInOrder(sourceRoute);
    if (orderedRouteParamNames.length < 1) {
      return null;
    }

    const normalizedRecordIdParam = normalizeText(recordIdParam) || "recordId";
    const parentParamName = [...orderedRouteParamNames]
      .reverse()
      .find((name) => (
        name !== "workspaceSlug" &&
        name !== normalizedRecordIdParam &&
        lookupFieldKeySet.has(name)
      )) || "";
    if (!parentParamName) {
      return null;
    }

    const routeParams = resolveRouteParamsSource(sourceRoute?.params || {});
    const parentParamValue = toRouteParamValue(routeParams[parentParamName]);
    if (!parentParamValue) {
      return null;
    }

    return Object.freeze({
      key: parentParamName,
      value: parentParamValue
    });
  });
  const activeSearchQuery = computed(() => {
    if (searchConfig.enabled !== true) {
      return "";
    }
    const normalized = normalizeText(debouncedSearchQuery.value);
    if (!normalized || normalized.length < searchConfig.minLength) {
      return "";
    }
    return normalized;
  });
  const querySearchEnabled = computed(() => searchConfig.enabled === true && searchConfig.mode === "query");
  const listPath = computed(() => {
    const basePath = normalizeText(operationScope.apiPath.value);
    if (!basePath) {
      return "";
    }

    const searchParams = new URLSearchParams();
    if (querySearchEnabled.value) {
      const queryValue = activeSearchQuery.value;
      if (queryValue) {
        searchParams.set(searchConfig.queryParam, queryValue);
      }
    }

    const parentFilter = parentRouteFilter.value;
    if (parentFilter) {
      searchParams.set(parentFilter.key, parentFilter.value);
    }

    const serializedSearch = searchParams.toString();
    if (!serializedSearch) {
      return basePath;
    }

    return appendQueryString(basePath, serializedSearch);
  });
  const listQueryKey = computed(() => {
    const sourceQueryKey = operationScope.queryKey.value;
    const baseQueryKey = Array.isArray(sourceQueryKey)
      ? [...sourceQueryKey]
      : sourceQueryKey == null
        ? []
        : [sourceQueryKey];
    const parentFilter = parentRouteFilter.value;
    if (parentFilter) {
      baseQueryKey.push("__parent__", parentFilter.key, parentFilter.value);
    }
    if (querySearchEnabled.value) {
      baseQueryKey.push("__search__", searchConfig.queryParam, activeSearchQuery.value);
    }
    return baseQueryKey;
  });

  const list = useListCore({
    queryKey: listQueryKey,
    path: listPath,
    enabled: operationScope.queryCanRun(canView),
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });
  watch(activeSearchQuery, (nextValue, previousValue) => {
    if (!querySearchEnabled.value) {
      return;
    }
    if (nextValue === previousValue) {
      return;
    }

    list.trimToFirstPage();
  });
  const filteredItems = computed(() => {
    const sourceItems = Array.isArray(list.items.value) ? list.items.value : [];
    if (searchConfig.enabled !== true || searchConfig.mode !== "local") {
      return sourceItems;
    }

    const queryValue = activeSearchQuery.value;
    if (!queryValue) {
      return sourceItems;
    }

    return sourceItems.filter((item) => matchesLocalSearch(item, queryValue, searchConfig.fields));
  });

  const isInitialLoading = operationScope.isLoading(list.isInitialLoading);
  const isFetching = operationScope.isLoading(list.isFetching);
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const loadError = operationScope.loadError(list.loadError);
  const isLoading = operationScope.isLoading(list.isLoading);
  const listUiRuntime = createListUiRuntime({
    items: filteredItems,
    isInitialLoading,
    recordIdParam,
    recordIdSelector,
    routeParams: computed(() => operationScope.routeContext.route?.params || {}),
    routePath: computed(() => operationScope.routeContext.route?.path || ""),
    viewUrlTemplate,
    editUrlTemplate
  });
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError,
    dedupeWindowMs: 0,
    loadActionFactory: () => ({
      label: "Retry",
      dismissOnRun: true,
      handler() {
        void list.reload();
      }
    })
  });

  return proxyRefs({
    canView,
    isInitialLoading,
    isFetching,
    isRefetching,
    isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    loadError,
    pages: list.pages,
    items: filteredItems,
    reload: list.reload,
    loadMore: list.loadMore,
    hasViewUrl: listUiRuntime.hasViewUrl,
    hasEditUrl: listUiRuntime.hasEditUrl,
    actionColumnCount: listUiRuntime.actionColumnCount,
    showListSkeleton: listUiRuntime.showListSkeleton,
    resolveRowKey: listUiRuntime.resolveRowKey,
    resolveParams: listUiRuntime.resolveParams,
    resolveViewUrl: listUiRuntime.resolveViewUrl,
    resolveEditUrl: listUiRuntime.resolveEditUrl,
    resolveFieldDisplay: resolveLookupFieldDisplayValue,
    searchEnabled: searchConfig.enabled,
    searchMode: searchConfig.mode,
    searchQuery,
    searchLabel: searchConfig.label,
    searchPlaceholder: searchConfig.placeholder,
    isSearchDebouncing
  });
}

export { useList };
