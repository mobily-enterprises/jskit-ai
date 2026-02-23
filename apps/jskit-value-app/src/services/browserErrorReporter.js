import { resolveSurfaceFromPathname } from "../../shared/routing/surfacePaths.js";

const REPORT_ENDPOINT = "/api/console/errors/browser";
const MAX_REPORTS_IN_FLIGHT = 8;

let installed = false;
let reportsInFlight = 0;
let suppressReporting = false;

function stringifyReason(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message || value.name || "Unhandled rejection";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toStack(value) {
  if (value instanceof Error) {
    return String(value.stack || "");
  }

  if (value && typeof value === "object" && typeof value.stack === "string") {
    return String(value.stack);
  }

  return "";
}

function buildBasePayload(source) {
  const path = typeof window !== "undefined" ? String(window.location?.pathname || "/") : "/";
  const href = typeof window !== "undefined" ? String(window.location?.href || "") : "";
  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";

  return {
    occurredAt: new Date().toISOString(),
    source,
    url: href,
    path,
    surface: resolveSurfaceFromPathname(path),
    userAgent
  };
}

function createPayloadFromErrorEvent(event) {
  const error = event?.error;

  return {
    ...buildBasePayload("window.error"),
    errorName: String(error?.name || ""),
    message: String(event?.message || error?.message || "Unknown browser error"),
    stack: toStack(error),
    lineNumber: Number.isInteger(event?.lineno) && event.lineno > 0 ? event.lineno : null,
    columnNumber: Number.isInteger(event?.colno) && event.colno > 0 ? event.colno : null,
    metadata: {
      filename: String(event?.filename || "")
    }
  };
}

function createPayloadFromRejectionEvent(event) {
  const reason = event?.reason;

  return {
    ...buildBasePayload("unhandledrejection"),
    errorName: String(reason?.name || ""),
    message: stringifyReason(reason) || "Unhandled promise rejection",
    stack: toStack(reason),
    metadata: {
      reasonType:
        reason == null
          ? "nullish"
          : Array.isArray(reason)
            ? "array"
            : typeof reason === "object"
              ? "object"
              : typeof reason
    }
  };
}

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
        const payload = createPayloadFromErrorEvent(event);
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
      const payload = createPayloadFromRejectionEvent(event);
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
  sendBrowserErrorReport
};

export { installBrowserErrorReporter, __testables };
