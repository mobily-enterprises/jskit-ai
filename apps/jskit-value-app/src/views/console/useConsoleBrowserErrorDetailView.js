import { computed, reactive } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery } from "@tanstack/vue-query";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { api } from "../../services/api/index.js";

function resolveErrorIdFromPath(pathname) {
  const match = String(pathname || "").match(/\/errors\/browser\/([0-9]+)/i);
  if (!match) {
    return "";
  }

  return String(match[1] || "").trim();
}

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

export function useConsoleBrowserErrorDetailView() {
  const navigate = useNavigate();
  const { handleUnauthorizedError } = useAuthGuard();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });

  const surfacePaths = computed(() => resolveSurfacePaths(routerPath.value));
  const errorId = computed(() => resolveErrorIdFromPath(routerPath.value));
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

  const error = useQueryErrorMessage({
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
