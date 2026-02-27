function createBrowserErrorPayloadTools({ resolveSurfaceFromPathname } = {}) {
  const resolveSurface =
    typeof resolveSurfaceFromPathname === "function" ? resolveSurfaceFromPathname : () => "unknown";

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
      surface: resolveSurface(path),
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

  return {
    stringifyReason,
    toStack,
    buildBasePayload,
    createPayloadFromErrorEvent,
    createPayloadFromRejectionEvent
  };
}

export { createBrowserErrorPayloadTools };
