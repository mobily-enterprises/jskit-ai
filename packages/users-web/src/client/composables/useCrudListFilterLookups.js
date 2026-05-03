import { computed, proxyRefs, ref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY
} from "@jskit-ai/kernel/shared/support/crudListFilters";
import { useList } from "./records/useList.js";
import {
  normalizeLookupQueryKeyPrefix,
  normalizeLookupLabelResolverMap,
  normalizeLookupRequestQueryParamsMap,
  resolveLookupSelectedValues,
  createLookupOptionsFromItems,
  mergeSelectedLookupOptions,
  resolveLookupOptionLabel
} from "./internal/crudListFilterLookupSupport.js";
import { inferCrudLookupJsonApiTransport } from "./crud/crudJsonApiTransportSupport.js";

function useCrudListFilterLookups(
  definitions = {},
  {
    values = {},
    adapter = null,
    recordIdParam = "recordId",
    queryKeyPrefix = [],
    placementSourcePrefix = "",
    requestQueryParams = {},
    labelResolvers = {}
  } = {}
) {
  const filters = defineCrudListFilters(definitions);
  const filterEntries = Object.values(filters);
  const normalizedQueryKeyPrefix = normalizeLookupQueryKeyPrefix(queryKeyPrefix);
  const normalizedPlacementSourcePrefix = normalizeText(placementSourcePrefix);
  const normalizedLabelResolvers = normalizeLookupLabelResolverMap(labelResolvers);
  const normalizedRequestQueryParams = normalizeLookupRequestQueryParamsMap(requestQueryParams);
  const lookups = {};

  for (const filter of filterEntries) {
    if (
      filter.type !== CRUD_LIST_FILTER_TYPE_RECORD_ID &&
      filter.type !== CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY
    ) {
      continue;
    }
    if (!filter.lookup?.apiSuffix) {
      continue;
    }
    const transport = inferCrudLookupJsonApiTransport({
      apiPath: filter.lookup.apiSuffix
    });

    const runtime = useList({
      adapter: adapter || undefined,
      apiSuffix: filter.lookup.apiSuffix,
      ...(transport ? { transport } : {}),
      queryKeyFactory: (surfaceId = "", scopeParamValue = "") => [
        ...normalizedQueryKeyPrefix,
        filter.key,
        String(surfaceId || ""),
        String(scopeParamValue || "")
      ],
      search: {
        enabled: true,
        mode: "query"
      },
      ...(Object.hasOwn(normalizedRequestQueryParams, filter.key)
        ? { requestQueryParams: normalizedRequestQueryParams[filter.key] }
        : {}),
      placementSource: normalizedPlacementSourcePrefix
        ? `${normalizedPlacementSourcePrefix}.${filter.key}`
        : `crud.list-filter.lookup.${filter.key}`,
      fallbackLoadError: `Unable to load filter options (${filter.lookup.apiSuffix}).`,
      recordIdParam,
      recordIdSelector: (item = {}) => item[filter.lookup.valueKey || "id"],
      viewUrlTemplate: "",
      editUrlTemplate: ""
    });

    const cachedOptions = ref(new Map());
    const selectedValues = computed(() => resolveLookupSelectedValues(filter, values?.[filter.key]));
    const currentOptions = computed(() => createLookupOptionsFromItems(
      Array.isArray(runtime.items) ? runtime.items : [],
      filter,
      normalizedLabelResolvers[filter.key]
    ));
    const options = computed(() => {
      return mergeSelectedLookupOptions(
        currentOptions.value,
        selectedValues.value,
        cachedOptions.value
      );
    });

    watch(currentOptions, (nextOptions) => {
      const nextCache = new Map(cachedOptions.value);
      for (const option of nextOptions) {
        nextCache.set(option.value, option);
      }
      cachedOptions.value = nextCache;
    }, { immediate: true });

    lookups[filter.key] = proxyRefs({
      filter,
      options,
      searchQuery: computed(() => String(runtime.searchQuery || "")),
      isLoading: computed(() => {
        return Boolean(runtime.isInitialLoading || runtime.isFetching || runtime.isRefetching || runtime.isSearchDebouncing);
      }),
      resolveLabel(value, fallback = filter.label || "Option") {
        return resolveLookupOptionLabel(options.value, cachedOptions.value, value, fallback);
      },
      setSearch(value = "") {
        runtime.searchQuery = normalizeText(value);
      }
    });
  }

  function resolveLookup(filterKey = "") {
    return lookups[normalizeText(filterKey)] || null;
  }

  return Object.freeze({
    lookups: Object.freeze(lookups),
    resolveLookup,
    resolveLookupItems(filterKey = "") {
      return resolveLookup(filterKey)?.options || [];
    },
    resolveLookupLoading(filterKey = "") {
      return Boolean(resolveLookup(filterKey)?.isLoading);
    },
    resolveLookupSearch(filterKey = "") {
      return String(resolveLookup(filterKey)?.searchQuery || "");
    },
    setLookupSearch(filterKey = "", value = "") {
      resolveLookup(filterKey)?.setSearch(value);
    },
    resolveLookupLabel(filterKey = "", value = "", fallback = "Option") {
      return resolveLookup(filterKey)?.resolveLabel(value, fallback)
        || resolveLookupOptionLabel([], new Map(), value, fallback);
    }
  });
}

export { useCrudListFilterLookups };
