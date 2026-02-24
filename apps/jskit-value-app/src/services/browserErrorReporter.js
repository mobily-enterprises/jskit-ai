import { createBrowserErrorPayloadTools } from "@jskit-ai/observability-core/browserPayload";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";

const REPORT_ENDPOINT = "/api/console/errors/browser";
const MAX_REPORTS_IN_FLIGHT = 8;

let installed = false;
let reportsInFlight = 0;
let suppressReporting = false;

const browserPayloadTools = createBrowserErrorPayloadTools({
  resolveSurfaceFromPathname
});

const {
  stringifyReason,
  toStack,
  buildBasePayload,
  createPayloadFromErrorEvent,
  createPayloadFromRejectionEvent
} = browserPayloadTools;

async function sendBrowserErrorReport(payload) {
  if (typeof fetch !== "function") {
    return;
  }

  if (reportsInFlight >= MAX_REPORTS_IN_FLIGHT) {
    return;
  }

  reportsInFlight += 1;

  try {
    await fetch(REPORT_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "x-console-error-report": "1"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    // Best effort only.
  } finally {
    reportsInFlight = Math.max(0, reportsInFlight - 1);
  }
}

function enrichBrowserErrorPayload(payload) {
  const normalizedPayload = payload && typeof payload === "object" ? payload : {};
  if (typeof window === "undefined") {
    return normalizedPayload;
  }

  const pathname = String(window.location?.pathname || "/");
  const surfaceId = resolveSurfaceFromPathname(pathname);
  const workspaceSlug = createSurfacePaths(surfaceId).extractWorkspaceSlug(pathname);
  const search = String(window.location?.search || "");
  const hash = String(window.location?.hash || "");
  const visibilityState =
    typeof document !== "undefined" ? String(document.visibilityState || "unknown") : "unknown";
  const language = typeof navigator !== "undefined" ? String(navigator.language || "") : "";
  const online = typeof navigator !== "undefined" ? Boolean(navigator.onLine) : null;
  const metadata =
    normalizedPayload.metadata && typeof normalizedPayload.metadata === "object" ? normalizedPayload.metadata : {};

  return {
    ...normalizedPayload,
    metadata: {
      ...metadata,
      surfaceId,
      workspaceSlug,
      routePath: pathname,
      routeSearch: search,
      routeHash: hash,
      visibilityState,
      language,
      online
    }
  };
}

function installBrowserErrorReporter() {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;

  window.addEventListener(
    "error",
    (event) => {
      if (suppressReporting) {
        return;
      }

      suppressReporting = true;
      try {
        const payload = enrichBrowserErrorPayload(createPayloadFromErrorEvent(event));
        void sendBrowserErrorReport(payload);
      } finally {
        suppressReporting = false;
      }
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    if (suppressReporting) {
      return;
    }

    suppressReporting = true;
    try {
      const payload = enrichBrowserErrorPayload(createPayloadFromRejectionEvent(event));
      void sendBrowserErrorReport(payload);
    } finally {
      suppressReporting = false;
    }
  });
}

const __testables = {
  stringifyReason,
  toStack,
  buildBasePayload,
  createPayloadFromErrorEvent,
  createPayloadFromRejectionEvent,
  enrichBrowserErrorPayload,
  sendBrowserErrorReport
};

export { installBrowserErrorReporter, __testables };
