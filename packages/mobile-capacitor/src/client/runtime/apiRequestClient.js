const API_ROUTE_PREFIXES = Object.freeze([
  "/api",
  "/socket.io"
]);
const LOCAL_SHELL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseAbsoluteHttpUrl(url = "", {
  apiBaseUrl = "",
  emptyUrlMessage = "URL is required.",
  missingApiBaseUrlMessage = "config.mobile.apiBaseUrl is required.",
  invalidApiBaseUrlMessage = "config.mobile.apiBaseUrl must be a valid absolute URL.",
  invalidApiBaseUrlProtocolMessage = "config.mobile.apiBaseUrl must use http or https.",
  invalidUrlProtocolMessage = "URL must use http or https."
} = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    throw new Error(emptyUrlMessage);
  }

  let absoluteUrl = null;
  try {
    absoluteUrl = new URL(normalizedUrl);
  } catch {}

  if (absoluteUrl) {
    const protocol = String(absoluteUrl.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error(invalidUrlProtocolMessage);
    }
    return absoluteUrl.toString();
  }

  const normalizedApiBaseUrl = String(apiBaseUrl || "").trim();
  if (!normalizedApiBaseUrl) {
    throw new Error(missingApiBaseUrlMessage);
  }

  let baseUrl;
  try {
    baseUrl = new URL(normalizedApiBaseUrl);
  } catch {
    throw new Error(invalidApiBaseUrlMessage);
  }

  const baseProtocol = String(baseUrl.protocol || "").toLowerCase();
  if (baseProtocol !== "http:" && baseProtocol !== "https:") {
    throw new Error(invalidApiBaseUrlProtocolMessage);
  }

  return new URL(normalizedUrl, baseUrl).toString();
}

function resolveCapacitorAbsoluteHttpUrl(url = "", apiBaseUrl = "", messages = {}) {
  return parseAbsoluteHttpUrl(url, {
    ...messages,
    apiBaseUrl
  });
}

function isCapacitorApiRequestTarget(url = "") {
  const normalizedUrl = String(url || "").trim();
  if (normalizedUrl.startsWith("/")) {
    return API_ROUTE_PREFIXES.some((prefix) => normalizedUrl === prefix || normalizedUrl.startsWith(`${prefix}/`));
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return false;
  }

  const protocol = String(parsedUrl.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return false;
  }

  const hostname = String(parsedUrl.hostname || "").trim().toLowerCase();
  if (!LOCAL_SHELL_HOSTS.has(hostname)) {
    return false;
  }

  const pathname = String(parsedUrl.pathname || "").trim();
  return API_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeFetchInput(input = "") {
  if (typeof input === "string") {
    return Object.freeze({
      rawUrl: input,
      rebuild(nextUrl) {
        return nextUrl;
      }
    });
  }

  if (typeof URL === "function" && input instanceof URL) {
    return Object.freeze({
      rawUrl: input.toString(),
      rebuild(nextUrl) {
        return nextUrl;
      }
    });
  }

  if (typeof Request === "function" && input instanceof Request) {
    return Object.freeze({
      rawUrl: String(input.url || ""),
      rebuild(nextUrl) {
        return new Request(nextUrl, input);
      }
    });
  }

  return Object.freeze({
    rawUrl: "",
    rebuild() {
      return input;
    }
  });
}

function createCapacitorAwareFetch({
  fetchImpl = globalThis.fetch,
  adapter = null,
  apiBaseUrl = ""
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("createCapacitorAwareFetch requires fetchImpl.");
  }

  return async function capacitorAwareFetch(input, init) {
    if (adapter?.available !== true) {
      return fetchImpl(input, init);
    }

    const normalizedInput = normalizeFetchInput(input);
    if (!isCapacitorApiRequestTarget(normalizedInput.rawUrl)) {
      return fetchImpl(input, init);
    }

    const sourceUrl = normalizeCapacitorApiRequestSourceUrl(normalizedInput.rawUrl);
    const resolvedUrl = resolveCapacitorAbsoluteHttpUrl(sourceUrl, apiBaseUrl, {
      emptyUrlMessage: "Capacitor API request URL is required.",
      missingApiBaseUrlMessage: "config.mobile.apiBaseUrl is required for Capacitor API requests.",
      invalidUrlProtocolMessage: "Capacitor API request URL must use http or https."
    });

    return fetchImpl(normalizedInput.rebuild(resolvedUrl), init);
  };
}

function normalizeCapacitorApiRequestSourceUrl(url = "") {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return normalizedUrl;
  }
  if (normalizedUrl.startsWith("/")) {
    return normalizedUrl;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const protocol = String(parsedUrl.protocol || "").toLowerCase();
    const hostname = String(parsedUrl.hostname || "").trim().toLowerCase();
    if ((protocol === "http:" || protocol === "https:") && LOCAL_SHELL_HOSTS.has(hostname)) {
      return `${parsedUrl.pathname || "/"}${parsedUrl.search || ""}${parsedUrl.hash || ""}`;
    }
  } catch {}

  return normalizedUrl;
}

export {
  createCapacitorAwareFetch,
  isCapacitorApiRequestTarget,
  normalizeCapacitorApiRequestSourceUrl,
  resolveCapacitorAbsoluteHttpUrl
};
