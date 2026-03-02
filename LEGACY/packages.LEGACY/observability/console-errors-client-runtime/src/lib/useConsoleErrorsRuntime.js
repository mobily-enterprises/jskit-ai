import { computed, reactive, ref } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { createHttpClient } from "@jskit-ai/http-client-runtime/server";
import { createConsoleErrorsApi } from "@jskit-ai/observability-core/server";
import { useListRuntime, useListPagination, useQueryErrorMessage } from "@jskit-ai/web-runtime-core/server";
import { createDefaultAppSurfacePaths } from "@jskit-ai/surface-routing/appSurfaces";

const SERVER_ERRORS_QUERY_KEY_PREFIX = ["console-server-errors"];
const BROWSER_ERRORS_QUERY_KEY_PREFIX = ["console-browser-errors"];
const SERVER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];
const BROWSER_ERRORS_PAGE_SIZE_OPTIONS = [20, 50, 100];

const SERVER_SIMULATION_SEQUENCE = [
  { kind: "app_error", label: "AppError 500" },
  { kind: "type_error", label: "TypeError 500" },
  { kind: "range_error", label: "RangeError 500" },
  { kind: "async_rejection", label: "Async rejection 500" }
];

const CLIENT_SIMULATION_SEQUENCE = [
  { kind: "uncaught_error", label: "Uncaught Error" },
  { kind: "unhandled_rejection", label: "Unhandled Rejection" },
  { kind: "type_error", label: "TypeError" }
];

const DEFAULT_USE_AUTH_GUARD = () => ({
  async handleUnauthorizedError() {
    return false;
  }
});

const DEFAULT_SURFACE_PATHS = createDefaultAppSurfacePaths();

function normalizeText(value) {
  return String(value || "").trim();
}

function parseInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return 0;
  }
  return parsed;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleString();
}

function summarizeServerMessage(entry) {
  const errorName = normalizeText(entry?.errorName);
  const message = normalizeText(entry?.message);
  if (errorName && message) {
    return `${errorName}: ${message}`;
  }
  return errorName || message || "Unknown server error";
}

function summarizeBrowserMessage(entry) {
  const errorName = normalizeText(entry?.errorName);
  const message = normalizeText(entry?.message);
  if (errorName && message) {
    return `${errorName}: ${message}`;
  }
  return errorName || message || "Unknown browser error";
}

function formatRequest(entry) {
  const method = normalizeText(entry?.method).toUpperCase();
  const path = normalizeText(entry?.path);
  if (method && path) {
    return `${method} ${path}`;
  }
  return path || method || "unknown";
}

function formatLocation(entry) {
  const path = normalizeText(entry?.path);
  const line = parseInteger(entry?.lineNumber);
  const column = parseInteger(entry?.columnNumber);
  if (!path && !line) {
    return "unknown";
  }
  if (!line) {
    return path;
  }
  if (!column) {
    return `${path}:${line}`;
  }
  return `${path}:${line}:${column}`;
}

function formatJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "{}";
  }
  const keys = Object.keys(value);
  if (keys.length < 1) {
    return "{}";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function createDefaultRequest() {
  const httpClient = createHttpClient();
  return httpClient.request;
}

function resolveConsoleErrorsApi({ api, request } = {}) {
  if (api && api.console) {
    return api;
  }
  const resolvedRequest = typeof request === "function" ? request : createDefaultRequest();
  return {
    console: createConsoleErrorsApi({ request: resolvedRequest })
  };
}

function resolveSurfacePaths(pathname) {
  return DEFAULT_SURFACE_PATHS.resolveSurfacePaths(pathname);
}

function createConsoleErrorsRuntime(deps = {}) {
  const api = resolveConsoleErrorsApi({ api: deps.api, request: deps.request });
  const useAuthGuard = typeof deps.useAuthGuard === "function" ? deps.useAuthGuard : DEFAULT_USE_AUTH_GUARD;
  const useQueryError = typeof deps.useQueryErrorMessage === "function" ? deps.useQueryErrorMessage : useQueryErrorMessage;
  const usePagination = typeof deps.useListPagination === "function" ? deps.useListPagination : useListPagination;
  const resolveSurface = typeof deps.resolveSurfacePaths === "function" ? deps.resolveSurfacePaths : resolveSurfacePaths;

  function useConsoleServerErrorsView({ initialPageSize = SERVER_ERRORS_PAGE_SIZE_OPTIONS[0] } = {}) {
    const navigate = useNavigate();
    const { handleUnauthorizedError } = useAuthGuard();
    const routerPath = useRouterState({
      select: (state) => state.location.pathname
    });
    const surfacePaths = computed(() => resolveSurface(routerPath.value));
    const simulateErrorBusy = ref(false);
    const simulationMessage = ref("");
    const simulationMessageType = ref("info");
    const simulationCursor = ref(0);

    const listRuntime = useListRuntime({
      queryKeyPrefix: SERVER_ERRORS_QUERY_KEY_PREFIX,
      fetchPage: (page, pageSize) => api.console.listServerErrors(page, pageSize),
      pageSizeOptions: SERVER_ERRORS_PAGE_SIZE_OPTIONS,
      initialPageSize,
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
      await listRuntime.actions.refresh();
    }

    async function viewEntry(entry) {
      const errorId = Number(entry?.id);
      if (!Number.isInteger(errorId) || errorId < 1) {
        return;
      }

      const target = `${surfacePaths.value.prefix}/errors/server/detail?id=${encodeURIComponent(errorId)}`;
      await navigate({
        to: target
      });
    }

    return {
      meta: {
        ...listRuntime.meta,
        formatDateTime,
        formatRequest,
        summarizeServerMessage,
        nextSimulationLabel
      },
      state: reactive({
        ...listRuntime.state,
        simulateErrorBusy,
        simulationMessage,
        simulationMessageType
      }),
      actions: {
        ...listRuntime.actions,
        load: listRuntime.actions.refresh,
        simulateServerError,
        viewEntry
      }
    };
  }

  function useConsoleBrowserErrorsView({ initialPageSize = BROWSER_ERRORS_PAGE_SIZE_OPTIONS[0] } = {}) {
    const navigate = useNavigate();
    const { handleUnauthorizedError } = useAuthGuard();
    const routerPath = useRouterState({
      select: (state) => state.location.pathname
    });
    const surfacePaths = computed(() => resolveSurface(routerPath.value));
    const simulationCursor = ref(0);
    const simulationMessage = ref("");
    const simulationMessageType = ref("info");

    const listRuntime = useListRuntime({
      queryKeyPrefix: BROWSER_ERRORS_QUERY_KEY_PREFIX,
      fetchPage: (page, pageSize) => api.console.listBrowserErrors(page, pageSize),
      pageSizeOptions: BROWSER_ERRORS_PAGE_SIZE_OPTIONS,
      initialPageSize,
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

      const target = `${surfacePaths.value.prefix}/errors/browser/detail?id=${encodeURIComponent(errorId)}`;
      await navigate({
        to: target
      });
    }

    return {
      meta: {
        ...listRuntime.meta,
        formatDateTime,
        formatLocation,
        summarizeBrowserMessage,
        nextSimulationLabel
      },
      state: reactive({
        ...listRuntime.state,
        simulationMessage,
        simulationMessageType
      }),
      actions: {
        ...listRuntime.actions,
        load: listRuntime.actions.refresh,
        simulateClientError,
        viewEntry
      }
    };
  }

  function useConsoleServerErrorDetailView() {
    const navigate = useNavigate();
    const { handleUnauthorizedError } = useAuthGuard();
    const routerState = useRouterState({
      select: (state) => ({ pathname: state.location.pathname, search: state.location.search })
    });
    const surfacePaths = computed(() => resolveSurface(routerState.value.pathname));

    const errorId = computed(() => {
      const params = new URLSearchParams(String(routerState.value.search || ""));
      return normalizeText(params.get("id"));
    });
    const hasValidErrorId = computed(() => Boolean(errorId.value));

    const query = useQuery({
      queryKey: computed(() => ["console-server-error-detail", errorId.value || "none"]),
      enabled: hasValidErrorId,
      queryFn: () => api.console.getServerError(errorId.value)
    });

    const entry = computed(() => {
      const source = query.data.value?.entry;
      return source && typeof source === "object" ? source : null;
    });

    const loading = computed(() => Boolean(query.isPending.value || query.isFetching.value));

    const error = useQueryError({
      query,
      handleUnauthorizedError,
      mapError: (nextError) => String(nextError?.message || "Unable to load server error entry.")
    });

    async function goBack() {
      await navigate({
        to: `${surfacePaths.value.prefix}/errors/server`
      });
    }

    return {
      meta: {
        formatDateTime,
        summarizeServerMessage,
        formatRequest,
        formatJson
      },
      state: reactive({
        errorId,
        hasValidErrorId,
        entry,
        loading,
        error
      }),
      actions: {
        refresh: () => query.refetch(),
        goBack
      }
    };
  }

  function useConsoleBrowserErrorDetailView() {
    const navigate = useNavigate();
    const { handleUnauthorizedError } = useAuthGuard();
    const routerState = useRouterState({
      select: (state) => ({ pathname: state.location.pathname, search: state.location.search })
    });
    const surfacePaths = computed(() => resolveSurface(routerState.value.pathname));

    const errorId = computed(() => {
      const params = new URLSearchParams(String(routerState.value.search || ""));
      return normalizeText(params.get("id"));
    });
    const hasValidErrorId = computed(() => Boolean(errorId.value));

    const query = useQuery({
      queryKey: computed(() => ["console-browser-error-detail", errorId.value || "none"]),
      enabled: hasValidErrorId,
      queryFn: () => api.console.getBrowserError(errorId.value)
    });

    const entry = computed(() => {
      const source = query.data.value?.entry;
      return source && typeof source === "object" ? source : null;
    });

    const loading = computed(() => Boolean(query.isPending.value || query.isFetching.value));

    const error = useQueryError({
      query,
      handleUnauthorizedError,
      mapError: (nextError) => String(nextError?.message || "Unable to load browser error entry.")
    });

    async function goBack() {
      await navigate({
        to: `${surfacePaths.value.prefix}/errors/browser`
      });
    }

    return {
      meta: {
        formatDateTime,
        formatLocation,
        summarizeBrowserMessage,
        formatJson
      },
      state: reactive({
        errorId,
        hasValidErrorId,
        entry,
        loading,
        error
      }),
      actions: {
        refresh: () => query.refetch(),
        goBack
      }
    };
  }

  return {
    useConsoleServerErrorsView,
    useConsoleBrowserErrorsView,
    useConsoleServerErrorDetailView,
    useConsoleBrowserErrorDetailView
  };
}

export { createConsoleErrorsRuntime };
