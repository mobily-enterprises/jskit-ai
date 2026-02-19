import { computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useListQueryState } from "../../composables/useListQueryState.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { api } from "../../services/api/index.js";

const CONSOLE_SERVER_ERRORS_QUERY_KEY_PREFIX = ["console-server-errors"];
const SERVER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function summarizeServerMessage(entry) {
  const errorName = String(entry?.errorName || "").trim();
  const message = String(entry?.message || "").trim();

  if (errorName && message) {
    return `${errorName}: ${message}`;
  }

  if (errorName) {
    return errorName;
  }

  return message || "Unknown server error";
}

function formatRequest(entry) {
  const method = String(entry?.method || "").trim().toUpperCase();
  const path = String(entry?.path || "").trim();

  if (method && path) {
    return `${method} ${path}`;
  }

  if (path) {
    return path;
  }

  return method || "unknown";
}

export function useConsoleServerErrorsView({ initialPageSize = SERVER_ERRORS_PAGE_SIZE_OPTIONS[0] } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const pagination = useUrlListPagination({
    pageKey: "page",
    pageSizeKey: "pageSize",
    initialPageSize,
    defaultPageSize: SERVER_ERRORS_PAGE_SIZE_OPTIONS[0],
    pageSizeOptions: SERVER_ERRORS_PAGE_SIZE_OPTIONS
  });

  const query = useQuery({
    queryKey: computed(() => [
      ...CONSOLE_SERVER_ERRORS_QUERY_KEY_PREFIX,
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.console.listServerErrors(pagination.page.value, pagination.pageSize.value),
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
    mapError: (nextError) => String(nextError?.message || "Unable to load server errors.")
  });

  return {
    meta: {
      pageSizeOptions: SERVER_ERRORS_PAGE_SIZE_OPTIONS,
      formatDateTime,
      formatRequest,
      summarizeServerMessage
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
