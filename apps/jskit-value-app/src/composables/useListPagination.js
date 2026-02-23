import { ref } from "vue";
import { getFirstPage, getNextPage, getPreviousPage, normalizePage, normalizePageSize } from "../utils/pagination.js";

function resolveValue(valueOrGetter, fallback) {
  if (typeof valueOrGetter === "function") {
    const value = valueOrGetter();
    return value == null ? fallback : value;
  }

  return valueOrGetter == null ? fallback : valueOrGetter;
}

export function useListPagination({
  initialPage,
  initialPageSize,
  defaultPageSize,
  getIsLoading = false,
  getTotalPages = 1
}) {
  const page = ref(normalizePage(initialPage, getFirstPage()));
  const pageSize = ref(normalizePageSize(initialPageSize, defaultPageSize));

  function resetToFirstPage() {
    page.value = getFirstPage();
  }

  function goPrevious({ isLoading } = {}) {
    const resolvedIsLoading = Boolean(resolveValue(isLoading, resolveValue(getIsLoading, false)));

    page.value = getPreviousPage({
      page: page.value,
      isLoading: resolvedIsLoading
    });
  }

  function goNext({ totalPages, isLoading } = {}) {
    const resolvedTotalPages = resolveValue(totalPages, resolveValue(getTotalPages, 1));
    const resolvedIsLoading = Boolean(resolveValue(isLoading, resolveValue(getIsLoading, false)));

    page.value = getNextPage({
      page: page.value,
      totalPages: resolvedTotalPages,
      isLoading: resolvedIsLoading
    });
  }

  function onPageSizeChange(nextPageSize) {
    if (nextPageSize !== undefined) {
      pageSize.value = normalizePageSize(nextPageSize, pageSize.value);
    }

    resetToFirstPage();
  }

  return {
    page,
    pageSize,
    resetToFirstPage,
    goPrevious,
    goNext,
    onPageSizeChange
  };
}
