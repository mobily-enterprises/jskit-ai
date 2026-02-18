import { ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useListPagination } from "./useListPagination.js";
import { getFirstPage, normalizePage, normalizePageSize } from "../utils/pagination.js";

function toSearchObject(search) {
  return search && typeof search === "object" ? search : {};
}

function normalizePageSizeOptions(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => normalizePageSize(value, 0))
    .filter((value) => Number.isInteger(value) && value > 0);

  return Array.from(new Set(normalized));
}

function normalizeAllowedPageSize(value, fallback, options) {
  const normalized = normalizePageSize(value, fallback);
  if (options.length > 0 && !options.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

export function useUrlListPagination({
  pageKey = "page",
  pageSizeKey = "pageSize",
  initialPageSize,
  defaultPageSize,
  pageSizeOptions
} = {}) {
  const navigate = useNavigate();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const routerSearch = useRouterState({
    select: (state) => state.location.search
  });

  const normalizedPageSizeOptions = normalizePageSizeOptions(pageSizeOptions);
  const fallbackDefaultPageSize = normalizedPageSizeOptions[0] || 10;
  const normalizedDefaultPageSize = normalizeAllowedPageSize(
    defaultPageSize,
    fallbackDefaultPageSize,
    normalizedPageSizeOptions
  );
  const normalizedInitialPageSize = normalizeAllowedPageSize(
    initialPageSize,
    normalizedDefaultPageSize,
    normalizedPageSizeOptions
  );
  const defaultPage = getFirstPage();

  function resolvePageFromSearch(search) {
    return normalizePage(toSearchObject(search)[pageKey], defaultPage);
  }

  function resolvePageSizeFromSearch(search) {
    const source = toSearchObject(search);
    const rawPageSize = source[pageSizeKey];
    const hasPageSizeParam = rawPageSize != null && String(rawPageSize).trim() !== "";
    const fallback = hasPageSizeParam ? normalizedDefaultPageSize : normalizedInitialPageSize;
    const candidate = normalizePageSize(rawPageSize, fallback);
    if (normalizedPageSizeOptions.length > 0 && !normalizedPageSizeOptions.includes(candidate)) {
      return fallback;
    }
    return candidate;
  }

  const pagination = useListPagination({
    initialPage: resolvePageFromSearch(routerSearch.value),
    initialPageSize: resolvePageSizeFromSearch(routerSearch.value),
    defaultPageSize: normalizedDefaultPageSize
  });

  const syncingFromUrl = ref(false);

  watch(
    () => routerSearch.value,
    (search) => {
      const nextPage = resolvePageFromSearch(search);
      const nextPageSize = resolvePageSizeFromSearch(search);
      if (pagination.page.value === nextPage && pagination.pageSize.value === nextPageSize) {
        return;
      }

      syncingFromUrl.value = true;
      pagination.page.value = nextPage;
      pagination.pageSize.value = nextPageSize;
      syncingFromUrl.value = false;
    },
    { immediate: true }
  );

  watch([pagination.page, pagination.pageSize], async ([nextPageRaw, nextPageSizeRaw]) => {
    if (syncingFromUrl.value) {
      return;
    }

    const nextPage = normalizePage(nextPageRaw, defaultPage);
    const nextPageSize = normalizePageSize(nextPageSizeRaw, normalizedDefaultPageSize);
    const currentPage = resolvePageFromSearch(routerSearch.value);
    const currentPageSize = resolvePageSizeFromSearch(routerSearch.value);
    if (currentPage === nextPage && currentPageSize === nextPageSize) {
      return;
    }

    const currentPath = String(routerPath.value || "").trim();
    if (!currentPath) {
      return;
    }

    const nextSearch = {
      ...toSearchObject(routerSearch.value)
    };
    if (nextPage === defaultPage) {
      delete nextSearch[pageKey];
    } else {
      nextSearch[pageKey] = String(nextPage);
    }

    if (nextPageSize === normalizedInitialPageSize) {
      delete nextSearch[pageSizeKey];
    } else {
      nextSearch[pageSizeKey] = String(nextPageSize);
    }

    await navigate({
      to: currentPath,
      search: nextSearch,
      replace: true
    });
  });

  return pagination;
}
