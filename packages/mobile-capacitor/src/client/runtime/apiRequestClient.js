import { createTextError } from "../i18n.js";

const API_ROUTE_PREFIXES = Object.freeze([
  "/api",
  "/socket.io"
]);

// Each message is one of this package's message keys or a caller's own text.
function parseAbsoluteHttpUrl(url = "", {
  apiBaseUrl = "",
  emptyUrlMessage = "jskit.mobile.apiRequest.urlRequired",
  missingApiBaseUrlMessage = "jskit.mobile.apiRequest.apiBaseUrlRequired",
  invalidApiBaseUrlMessage = "jskit.mobile.apiRequest.apiBaseUrlInvalid",
  invalidApiBaseUrlProtocolMessage = "jskit.mobile.apiRequest.apiBaseUrlProtocol",
  invalidUrlProtocolMessage = "jskit.mobile.apiRequest.urlProtocol"
} = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    throw createTextError(emptyUrlMessage);
  }

  let absoluteUrl = null;
  try {
    absoluteUrl = new URL(normalizedUrl);
  } catch {}

  if (absoluteUrl) {
    const protocol = String(absoluteUrl.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      throw createTextError(invalidUrlProtocolMessage);
    }
    return absoluteUrl.toString();
  }

  const normalizedApiBaseUrl = String(apiBaseUrl || "").trim();
  if (!normalizedApiBaseUrl) {
    throw createTextError(missingApiBaseUrlMessage);
  }

  let baseUrl;
  try {
    baseUrl = new URL(normalizedApiBaseUrl);
  } catch {
    throw createTextError(invalidApiBaseUrlMessage);
  }

  const baseProtocol = String(baseUrl.protocol || "").toLowerCase();
  if (baseProtocol !== "http:" && baseProtocol !== "https:") {
    throw createTextError(invalidApiBaseUrlProtocolMessage);
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
  if (!normalizedUrl.startsWith("/")) {
    return false;
  }
  return API_ROUTE_PREFIXES.some((prefix) => normalizedUrl === prefix || normalizedUrl.startsWith(`${prefix}/`));
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

    const resolvedUrl = resolveCapacitorAbsoluteHttpUrl(normalizedInput.rawUrl, apiBaseUrl, {
      emptyUrlMessage: "jskit.mobile.apiRequest.requestUrlRequired",
      missingApiBaseUrlMessage: "jskit.mobile.apiRequest.apiBaseUrlRequiredForRequests",
      invalidUrlProtocolMessage: "jskit.mobile.apiRequest.requestUrlProtocol"
    });

    return fetchImpl(normalizedInput.rebuild(resolvedUrl), init);
  };
}

export {
  createCapacitorAwareFetch,
  isCapacitorApiRequestTarget,
  resolveCapacitorAbsoluteHttpUrl
};
