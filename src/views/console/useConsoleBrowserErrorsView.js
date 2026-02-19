import { computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useListQueryState } from "../../composables/useListQueryState.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { api } from "../../services/api/index.js";

const CONSOLE_BROWSER_ERRORS_QUERY_KEY_PREFIX = ["console-browser-errors"];
const BROWSER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function formatLocation(entry) {
  const path = String(entry?.path || "").trim();
  const line = Number(entry?.lineNumber);
  const column = Number(entry?.columnNumber);

  const locationLine = Number.isInteger(line) && line > 0 ? line : null;
  const locationColumn = Number.isInteger(column) && column > 0 ? column : null;

  if (!path && !locationLine) {
    return "unknown";
  }

  if (!locationLine) {
    return path;
  }

  if (!locationColumn) {
    return `${path}:${locationLine}`;
  }

  return `${path}:${locationLine}:${locationColumn}`;
}

function summarizeBrowserMessage(entry) {
  const errorName = String(entry?.errorName || "").trim();
  const message = String(entry?.message || "").trim();

  if (errorName && message) {
    return `${errorName}: ${message}`;
  }

  if (errorName) {
    return errorName;
  }

  return message || "Unknown browser error";
}

export function useConsoleBrowserErrorsView({ initialPageSize = BROWSER_ERRORS_PAGE_SIZE_OPTIONS[0] } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const pagination = useUrlListPagination({
    pageKey: "page",
    pageSizeKey: "pageSize",
    initialPageSize,
    defaultPageSize: BROWSER_ERRORS_PAGE_SIZE_OPTIONS[0],
    pageSizeOptions: BROWSER_ERRORS_PAGE_SIZE_OPTIONS
  });

  const query = useQuery({
    queryKey: computed(() => [
      ...CONSOLE_BROWSER_ERRORS_QUERY_KEY_PREFIX,
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.console.listBrowserErrors(pagination.page.value, pagination.pageSize.value),
    placeholderData: (previous) => previous
  });

  const entries = computed(() => {
    const source = query.data.value?.entries;
    return Array.isArray(source) ? source : [];
  });

  const { total, totalPages, loading } = useListQueryState(query);

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load browser errors.")
  });

  return {
    meta: {
      pageSizeOptions: BROWSER_ERRORS_PAGE_SIZE_OPTIONS,
      formatDateTime,
      formatLocation,
      summarizeBrowserMessage
    },
    state: reactive({
      entries,
      error,
      loading,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages
    }),
    actions: {
      load: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange
    }
  };
}
