import { computed, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useListQueryState } from "../../composables/useListQueryState.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { api } from "../../services/api/index.js";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";

const CONSOLE_SERVER_ERRORS_QUERY_KEY_PREFIX = ["console-server-errors"];
const SERVER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];
const SERVER_SIMULATION_SEQUENCE = [
  { kind: "app_error", label: "AppError 500" },
  { kind: "type_error", label: "TypeError 500" },
  { kind: "range_error", label: "RangeError 500" },
  { kind: "async_rejection", label: "Async rejection 500" }
];

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
  const navigate = useNavigate();
  const { handleUnauthorizedError } = useAuthGuard();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));
  const simulateErrorBusy = ref(false);
  const simulationMessage = ref("");
  const simulationMessageType = ref("info");
  const simulationCursor = ref(0);

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

  const nextSimulationLabel = computed(() => {
    const index = simulationCursor.value % SERVER_SIMULATION_SEQUENCE.length;
    return SERVER_SIMULATION_SEQUENCE[index].label;
  });

  function pickSimulationVariant() {
    const index = simulationCursor.value % SERVER_SIMULATION_SEQUENCE.length;
    simulationCursor.value += 1;
    return SERVER_SIMULATION_SEQUENCE[index];
  }

  async function simulateServerError() {
    simulationMessage.value = "";
    simulationMessageType.value = "info";
    simulateErrorBusy.value = true;

    const simulation = pickSimulationVariant();

    try {
      await api.console.simulateServerError({
        kind: simulation.kind
      });

      simulationMessageType.value = "success";
      simulationMessage.value = `Triggered simulated ${simulation.label}.`;
    } catch (nextError) {
      const handled = await handleUnauthorizedError(nextError);
      if (handled) {
        return;
      }

      if (Number(nextError?.status) >= 500) {
        simulationMessageType.value = "success";
        simulationMessage.value = `Triggered simulated ${simulation.label}.`;
      } else {
        simulationMessageType.value = "error";
        simulationMessage.value = String(nextError?.message || "Unable to trigger server simulation.");
      }
    } finally {
      simulateErrorBusy.value = false;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    await query.refetch();
  }

  async function viewEntry(entry) {
    const errorId = Number(entry?.id);
    if (!Number.isInteger(errorId) || errorId < 1) {
      return;
    }

    await navigate({
      to: `${surfacePaths.value.prefix}/errors/server/${errorId}`
    });
  }

  return {
    meta: {
      pageSizeOptions: SERVER_ERRORS_PAGE_SIZE_OPTIONS,
      formatDateTime,
      formatRequest,
      summarizeServerMessage,
      nextSimulationLabel
    },
    state: reactive({
      entries,
      error,
      loading,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
      simulateErrorBusy,
      simulationMessage,
      simulationMessageType
    }),
    actions: {
      load: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange,
      simulateServerError,
      viewEntry
    }
  };
}
