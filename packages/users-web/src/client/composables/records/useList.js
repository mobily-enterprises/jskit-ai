import { computed, onScopeDispose, proxyRefs, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useListCore } from "../runtime/useListCore.js";
import { resolveOperationAdapter } from "../runtime/operationAdapters.js";
import { setupOperationErrorReporting } from "../runtime/operationUiHelpers.js";
import { createListUiRuntime } from "../runtime/listUiRuntime.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import {
  normalizeListSearchConfig,
  matchesLocalSearch
} from "../support/listSearchSupport.js";
import {
  normalizeListSyncToRouteConfig,
  resolveQueryParamDescriptors,
  resolveActiveQueryParamEntries,
  resolveWritableQueryParamBindings,
  buildQueryParamEntriesToken,
  parseRouteBindingValue,
  areQueryParamBindingValuesEqual,
  buildRouteQueryCompareToken,
  mergeManagedQueryParamKeyHistory,
  resolveRouteSyncManagedKeys
} from "../support/listQueryParamSupport.js";
import {
  resolveRouteParamNamesInOrder,
} from "../support/routeTemplateHelpers.js";

const EMPTY_ROUTE_SYNC_QUERY_PARAM_BLACKLIST = Object.freeze([]);

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
  recordIdParam = "recordId",
  recordIdSelector = null,
  viewUrlTemplate = "",
  editUrlTemplate = "",
  search = null,
  queryParams = null,
  requestQueryParams = null,
  syncToRoute = false
} = {}) {
  const searchConfig = normalizeListSearchConfig(search);
  const routeSyncConfig = normalizeListSyncToRouteConfig(syncToRoute, {
    defaultSearchParam: searchConfig.queryParam
  });
  const router = routeSyncConfig.enabled === true ? useRouter() : null;
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
  if (
    routeSyncConfig.enabled === true &&
    routeSyncConfig.hydrateFromRoute === true &&
    routeSyncConfig.syncSearch === true &&
    searchConfig.enabled === true
  ) {
    const routeQuerySource = asPlainObject(operationScope.routeContext.route?.query || {});
    const routeSearchValue = routeQuerySource[routeSyncConfig.searchParam];
    const hydratedSearch = normalizeText(Array.isArray(routeSearchValue) ? routeSearchValue[0] : routeSearchValue);

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    searchQuery.value = hydratedSearch;
    debouncedSearchQuery.value = hydratedSearch;
    isSearchDebouncing.value = false;
  }
  const canView = operationScope.permissionGate("view");
  const queryParamsContext = computed(() => {
    return Object.freeze({
      surfaceId: operationScope.routeContext.currentSurfaceId.value,
      workspaceSlug: operationScope.workspaceSlugFromRoute.value,
      ownershipFilter: operationScope.normalizedOwnershipFilter
    });
  });
  const queryParamDescriptors = computed(() => {
    return resolveQueryParamDescriptors(queryParams, queryParamsContext.value);
  });
  const requestQueryParamDescriptors = computed(() => {
    return resolveQueryParamDescriptors(requestQueryParams, queryParamsContext.value);
  });
  const declaredQueryParamKeys = computed(() => {
    return queryParamDescriptors.value.map((descriptor) => descriptor.key);
  });
  const activeQueryParamEntries = computed(() => {
    return resolveActiveQueryParamEntries(queryParamDescriptors.value);
  });
  const activeRequestQueryParamEntries = computed(() => {
    return resolveActiveQueryParamEntries(requestQueryParamDescriptors.value);
  });
  const activeQueryParamsToken = computed(() => buildQueryParamEntriesToken(activeQueryParamEntries.value));
  const activeRequestQueryParamsToken = computed(() => {
    return buildQueryParamEntriesToken(activeRequestQueryParamEntries.value);
  });
  const writableQueryParamBindings = computed(() => {
    return resolveWritableQueryParamBindings(queryParamDescriptors.value);
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

    for (const entry of activeRequestQueryParamEntries.value) {
      for (const value of entry.values) {
        searchParams.append(entry.key, value);
      }
    }
    for (const entry of activeQueryParamEntries.value) {
      for (const value of entry.values) {
        searchParams.append(entry.key, value);
      }
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
    if (activeRequestQueryParamsToken.value) {
      baseQueryKey.push("__request_query__", activeRequestQueryParamsToken.value);
    }
    if (querySearchEnabled.value) {
      baseQueryKey.push("__search__", searchConfig.queryParam, activeSearchQuery.value);
    }
    if (activeQueryParamsToken.value) {
      baseQueryKey.push("__query__", activeQueryParamsToken.value);
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
  const routeSyncHydrated = ref(routeSyncConfig.enabled !== true);
  const routeSyncApplying = ref(false);
  const routeSyncManagedKeyHistory = ref([]);
  const routeSyncQueryParamBlacklist = computed(() => {
    if (routeSyncConfig.enabled !== true || routeSyncConfig.syncQueryParams !== true) {
      return EMPTY_ROUTE_SYNC_QUERY_PARAM_BLACKLIST;
    }
    return routeSyncConfig.queryParamBlacklist;
  });
  const routeSyncQueryParamBlacklistSet = computed(() => {
    return new Set(routeSyncQueryParamBlacklist.value);
  });
  if (routeSyncConfig.enabled === true && routeSyncConfig.syncQueryParams === true) {
    watch(declaredQueryParamKeys, (nextKeys) => {
      routeSyncManagedKeyHistory.value = mergeManagedQueryParamKeyHistory(
        routeSyncManagedKeyHistory.value,
        nextKeys
      );
    }, { immediate: true });
  }
  const routeSyncManagedKeys = computed(() => {
    const managedKeys = resolveRouteSyncManagedKeys({
      searchEnabled: searchConfig.enabled,
      searchParam: routeSyncConfig.searchParam,
      syncSearch: routeSyncConfig.enabled === true && routeSyncConfig.syncSearch === true,
      syncQueryParams: routeSyncConfig.enabled === true && routeSyncConfig.syncQueryParams === true,
      declaredKeys: declaredQueryParamKeys.value,
      keyHistory: routeSyncManagedKeyHistory.value
    });
    if (routeSyncConfig.enabled !== true || routeSyncConfig.syncQueryParams !== true) {
      return managedKeys;
    }

    const output = new Set(managedKeys);
    for (const key of routeSyncQueryParamBlacklist.value) {
      output.add(key);
    }
    return [...output].sort((left, right) => left.localeCompare(right));
  });
  const routeSyncDesiredQuery = computed(() => {
    if (routeSyncConfig.enabled !== true) {
      return {};
    }

    const desiredQuery = {};
    if (routeSyncConfig.syncSearch === true && searchConfig.enabled === true) {
      const normalizedSearch = normalizeText(searchQuery.value);
      if (normalizedSearch) {
        desiredQuery[routeSyncConfig.searchParam] = normalizedSearch;
      }
    }
    if (routeSyncConfig.syncQueryParams === true) {
      for (const entry of activeQueryParamEntries.value) {
        if (routeSyncQueryParamBlacklistSet.value.has(entry.key)) {
          continue;
        }
        if (entry.values.length === 1) {
          desiredQuery[entry.key] = entry.values[0];
          continue;
        }
        desiredQuery[entry.key] = [...entry.values];
      }
    }

    return desiredQuery;
  });
  if (routeSyncConfig.enabled === true) {
    watch(
      () => operationScope.routeContext.route?.query || {},
      (routeQuery) => {
        if (routeSyncConfig.hydrateFromRoute !== true || routeSyncApplying.value === true) {
          routeSyncHydrated.value = true;
          return;
        }

        const routeQuerySource = asPlainObject(routeQuery);
        if (routeSyncConfig.syncSearch === true && searchConfig.enabled === true) {
          const routeSearchValue = routeQuerySource[routeSyncConfig.searchParam];
          const nextSearch = normalizeText(Array.isArray(routeSearchValue) ? routeSearchValue[0] : routeSearchValue);
          if (nextSearch !== searchQuery.value) {
            searchQuery.value = nextSearch;
          }
        }
        if (routeSyncConfig.syncQueryParams === true) {
          for (const binding of writableQueryParamBindings.value) {
            if (routeSyncQueryParamBlacklistSet.value.has(binding.key)) {
              continue;
            }
            const nextValue = parseRouteBindingValue(binding, routeQuerySource[binding.key]);
            const currentValue = typeof binding.get === "function" ? binding.get() : undefined;
            if (areQueryParamBindingValuesEqual(currentValue, nextValue)) {
              continue;
            }
            try {
              binding.set(nextValue);
            } catch {
              // Ignore non-writable query param bindings.
            }
          }
        }

        routeSyncHydrated.value = true;
      },
      {
        immediate: true
      }
    );

    watch(
      [routeSyncDesiredQuery, routeSyncManagedKeys],
      async ([desiredQuery, managedKeys]) => {
        if (routeSyncHydrated.value !== true || routeSyncApplying.value === true) {
          return;
        }

        const managedKeySet = new Set(Array.isArray(managedKeys) ? managedKeys : []);
        const currentQuery = asPlainObject(operationScope.routeContext.route?.query || {});
        const nextQuery = {};

        for (const [key, value] of Object.entries(currentQuery)) {
          if (managedKeySet.has(key)) {
            continue;
          }
          nextQuery[key] = value;
        }
        for (const [key, value] of Object.entries(asPlainObject(desiredQuery))) {
          nextQuery[key] = value;
        }

        if (buildRouteQueryCompareToken(currentQuery) === buildRouteQueryCompareToken(nextQuery)) {
          return;
        }

        routeSyncApplying.value = true;
        try {
          if (routeSyncConfig.mode === "push") {
            await router.push({
              query: nextQuery
            });
          } else {
            await router.replace({
              query: nextQuery
            });
          }
        } finally {
          routeSyncApplying.value = false;
        }
      }
    );
  }

  watch(activeSearchQuery, (nextValue, previousValue) => {
    if (!querySearchEnabled.value) {
      return;
    }
    if (nextValue === previousValue) {
      return;
    }

    list.trimToFirstPage();
  });
  watch(activeQueryParamsToken, (nextValue, previousValue) => {
    if (nextValue === previousValue) {
      return;
    }

    list.trimToFirstPage();
  });
  watch(activeRequestQueryParamsToken, (nextValue, previousValue) => {
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
    routeParamNames: computed(() => resolveRouteParamNamesInOrder(operationScope.routeContext.route)),
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
    searchEnabled: searchConfig.enabled,
    searchMode: searchConfig.mode,
    searchQuery,
    searchLabel: searchConfig.label,
    searchPlaceholder: searchConfig.placeholder,
    isSearchDebouncing,
    activeQueryParamsToken
  });
}

export { useList };
