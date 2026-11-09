import { computed, proxyRefs, ref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY
} from "@jskit-ai/resource-crud-core/shared/crudListFilters";
import { useList } from "./records/useList.js";
import {
  normalizeLookupQueryKeyPrefix,
  normalizeLookupLabelResolverMap,
  normalizeLookupRequestQueryParamsMap,
  resolveLookupSelectedValues,
  createLookupOptionsFromItems,
  mergeSelectedLookupOptions,
  resolveUnlabeledLookupValues,
  resolveLookupOptionLabel
} from "./internal/crudListFilterLookupSupport.js";
import { inferCrudLookupJsonApiTransport } from "./crud/crudJsonApiTransportSupport.js";
import { resolveQueryParamsInput } from "./support/listQueryParamSupport.js";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();

/**
 * @param {Record<string, object>} [definitions]
 * @param {import("../types.js").CrudListFilterLookupsOptions} [options]
 */
function useCrudListFilterLookups(
  definitions = {},
  {
    values = {},
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
    const requestQueryParams = Object.hasOwn(normalizedRequestQueryParams, filter.key)
      ? normalizedRequestQueryParams[filter.key]
      : null;
    const queryKeyFactory = (part) => (surfaceId = "", scopeParamValue = "") => [
      ...normalizedQueryKeyPrefix,
      filter.key,
      ...(part ? [part] : []),
      String(surfaceId || ""),
      String(scopeParamValue || "")
    ];
    // The options load once something shows them (the open filter sheet's control, or a search), not with every list
    // page: the control sits in a closed sheet until the person opens it.
    const optionsWanted = ref(false);
    const wantOptions = () => {
      if (!optionsWanted.value) {
        optionsWanted.value = true;
      }
    };

    const runtime = useList({
      apiSuffix: filter.lookup.apiSuffix,
      ...(transport ? { transport } : {}),
      readEnabled: optionsWanted,
      queryKeyFactory: queryKeyFactory(""),
      search: {
        enabled: true,
        mode: "query"
      },
      ...(requestQueryParams ? { requestQueryParams } : {}),
      placementSource: normalizedPlacementSourcePrefix
        ? `${normalizedPlacementSourcePrefix}.${filter.key}`
        : `crud.list-filter.lookup.${filter.key}`,
      fallbackLoadError: t("jskit.http.crud.filters.optionsLoadFailed", { path: filter.lookup.apiSuffix }),
      recordIdParam,
      recordIdSelector: (item = {}) => item[filter.lookup.valueKey || "id"],
      viewUrlTemplate: "",
      editUrlTemplate: ""
    });

    const cachedOptions = ref(new Map());
    const selectedValues = computed(() => resolveLookupSelectedValues(filter, values[filter.key]));
    const currentOptions = computed(() => createLookupOptionsFromItems(
      Array.isArray(runtime.items) ? runtime.items : [],
      filter,
      normalizedLabelResolvers[filter.key]
    ));
    // A selected value past the loaded page (from the URL or a bookmark) is read by id, all of them in one request, so
    // its chip and option show its label instead of its raw id.
    const unlabeledValues = computed(() => resolveUnlabeledLookupValues(
      selectedValues.value,
      currentOptions.value,
      cachedOptions.value
    ));
    const selectedRuntime = (filter.lookup.valueKey || "id") === "id"
      ? useList({
          apiSuffix: filter.lookup.apiSuffix,
          ...(transport ? { transport } : {}),
          readEnabled: computed(() => unlabeledValues.value.length > 0),
          queryKeyFactory: queryKeyFactory("__selected__"),
          requestQueryParams: (context) => ({
            ...resolveQueryParamsInput(requestQueryParams, context),
            id: [...unlabeledValues.value]
          }),
          placementSource: normalizedPlacementSourcePrefix
            ? `${normalizedPlacementSourcePrefix}.${filter.key}.selected`
            : `crud.list-filter.lookup.${filter.key}.selected`,
          fallbackLoadError: t("jskit.http.crud.filters.optionsLoadFailed", { path: filter.lookup.apiSuffix }),
          recordIdParam,
          recordIdSelector: (item = {}) => item.id,
          viewUrlTemplate: "",
          editUrlTemplate: ""
        })
      : null;
    const selectedOptions = computed(() => createLookupOptionsFromItems(
      Array.isArray(selectedRuntime?.items) ? selectedRuntime.items : [],
      filter,
      normalizedLabelResolvers[filter.key]
    ));
    const options = computed(() => {
      return mergeSelectedLookupOptions(
        currentOptions.value,
        selectedValues.value,
        cachedOptions.value,
        { complete: runtime.hasMore !== true }
      );
    });

    watch([currentOptions, selectedOptions], ([nextOptions, nextSelectedOptions]) => {
      const nextCache = new Map(cachedOptions.value);
      for (const option of [...nextOptions, ...nextSelectedOptions]) {
        nextCache.set(option.value, option);
      }
      cachedOptions.value = nextCache;
    }, { immediate: true });

    lookups[filter.key] = proxyRefs({
      filter,
      get options() {
        wantOptions();
        return options.value;
      },
      searchQuery: computed(() => String(runtime.searchQuery || "")),
      isLoading: computed(() => {
        return Boolean(runtime.isInitialLoading || runtime.isFetching || runtime.isSearchDebouncing);
      }),
      // The options are one page; the rest load on request, or narrow with a search.
      hasMore: computed(() => runtime.hasMore === true),
      isLoadingMore: computed(() => runtime.isLoadingMore === true),
      loadMore() {
        wantOptions();
        return runtime.loadMore();
      },
      resolveLabel(value, fallback = text(filter.label) || t("jskit.http.crud.filters.option")) {
        return resolveLookupOptionLabel(options.value, cachedOptions.value, value, fallback);
      },
      setSearch(value = "") {
        wantOptions();
        runtime.searchQuery = normalizeText(value);
      }
    });
  }

  function resolveLookup(filterKey = "") {
    return lookups[normalizeText(filterKey)] || null;
  }

  return {
    lookups,
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
    resolveLookupHasMore(filterKey = "") {
      return Boolean(resolveLookup(filterKey)?.hasMore);
    },
    resolveLookupLoadingMore(filterKey = "") {
      return Boolean(resolveLookup(filterKey)?.isLoadingMore);
    },
    loadMoreLookup(filterKey = "") {
      return resolveLookup(filterKey)?.loadMore();
    },
    setLookupSearch(filterKey = "", value = "") {
      resolveLookup(filterKey)?.setSearch(value);
    },
    resolveLookupLabel(filterKey = "", value = "", fallback = t("jskit.http.crud.filters.option")) {
      return resolveLookup(filterKey)?.resolveLabel(value, fallback)
        || resolveLookupOptionLabel([], new Map(), value, fallback);
    }
  };
}

export { useCrudListFilterLookups };
