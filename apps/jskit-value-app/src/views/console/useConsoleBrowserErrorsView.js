import { computed, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useListQueryState } from "../../composables/useListQueryState.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { api } from "../../services/api/index.js";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";

const CONSOLE_BROWSER_ERRORS_QUERY_KEY_PREFIX = ["console-browser-errors"];
const BROWSER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];
const CLIENT_SIMULATION_SEQUENCE = [
  { kind: "uncaught_error", label: "Uncaught Error" },
  { kind: "unhandled_rejection", label: "Unhandled Rejection" },
  { kind: "type_error", label: "TypeError" }
];

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
  const navigate = useNavigate();
  const { handleUnauthorizedError } = useAuthGuard();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));
  const simulationCursor = ref(0);
  const simulationMessage = ref("");
  const simulationMessageType = ref("info");

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

  const nextSimulationLabel = computed(() => {
    const index = simulationCursor.value % CLIENT_SIMULATION_SEQUENCE.length;
    return CLIENT_SIMULATION_SEQUENCE[index].label;
  });

  function pickSimulationVariant() {
    const index = simulationCursor.value % CLIENT_SIMULATION_SEQUENCE.length;
    simulationCursor.value += 1;
    return CLIENT_SIMULATION_SEQUENCE[index];
  }

  function createSimulationId() {
    return `sim-client-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  function triggerClientCrash(simulation) {
    const simulationId = createSimulationId();
    const marker = `[simulated-client-error:${simulationId}]`;

    if (simulation.kind === "unhandled_rejection") {
      Promise.reject(new TypeError(`${marker} Simulated unhandled rejection.`));
      return;
    }

    if (simulation.kind === "type_error") {
      const nil = null;
      nil.invoke();
    }

    throw new Error(`${marker} Simulated uncaught runtime error.`);
  }

  function simulateClientError() {
    const simulation = pickSimulationVariant();
    simulationMessageType.value = "warning";
    simulationMessage.value = `Triggering ${simulation.label}. The app should crash and this will be captured.`;

    setTimeout(() => {
      triggerClientCrash(simulation);
    }, 0);
  }

  async function viewEntry(entry) {
    const errorId = Number(entry?.id);
    if (!Number.isInteger(errorId) || errorId < 1) {
      return;
    }

    await navigate({
      to: `${surfacePaths.value.prefix}/errors/browser/${errorId}`
    });
  }

  return {
    meta: {
      pageSizeOptions: BROWSER_ERRORS_PAGE_SIZE_OPTIONS,
      formatDateTime,
      formatLocation,
      summarizeBrowserMessage,
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
      simulationMessage,
      simulationMessageType
    }),
    actions: {
      load: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange,
      simulateClientError,
      viewEntry
    }
  };
}
