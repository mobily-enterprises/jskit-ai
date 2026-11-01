import { buildHttpError, buildNetworkError } from "./errors.js";
import { hasHeader, setHeaderIfMissing } from "./headers.js";
import { shouldRetryForCsrfFailure } from "./retry.js";
import { appendQueryString, isRecord } from "@jskit-ai/kernel/shared/support";
import { parseJsonSafely, readNdjsonStream, readNdjsonText } from "./responseBody.js";
import {
  JSON_API_CONTENT_TYPE,
  decodeJsonApiResourceDocument,
  encodeJsonApiResourceRequestBody,
  encodeJsonApiResourceQuery,
  normalizeJsonApiClientTransport
} from "./jsonApiResourceTransport.js";

const DEFAULT_UNSAFE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_NDJSON_CONTENT_TYPE = "application/x-ndjson";
const DEFAULT_READ_TIMEOUT_MS = 30_000;

function requestSignalWithDeadline(signal, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Request timeoutMs must be a positive finite integer.");
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function normalizeMethod(method) {
  return String(method || "GET")
    .trim()
    .toUpperCase();
}

function resolveUnsafeMethods(methods) {
  return new Set(methods.map((method) => normalizeMethod(method)).filter(Boolean));
}

function fetchWithGlobalFetch(url, config) {
  // readable-check: allow method-probe - platform object: a runtime without a global fetch needs fetchImpl
  if (typeof fetch !== "function") {
    throw new Error("createHttpClient requires fetchImpl when global fetch is unavailable.");
  }
  return fetch(url, config);
}

function keepRequestUrl(url) {
  return url;
}

function keepHeaders() {}

async function ignoreRequestOutcome() {}

/** Returns null, which keeps the client's own CSRF retry rule. */
function useCsrfRetryRule() {
  return null;
}

function useContentTypeForStream() {
  return false;
}

function ignoreStreamEvent() {}

function ignoreMalformedLine() {}

function normalizeResolvedRequestUrl(value, fallback = "") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value);
}

function isObjectBody(value) {
  return Boolean(value) && typeof value === "object" && !(value instanceof FormData);
}

function isQueryValuePresent(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => String(entry ?? "").trim());
  }
  return String(value ?? "").trim().length > 0;
}

function appendRequestQueryToUrl(url, query = null, transport = null) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return "";
  }

  const encodedQuery = transport ? encodeJsonApiResourceQuery(query, transport) : query;

  if (!isRecord(encodedQuery)) {
    return normalizedUrl;
  }

  const searchParams = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(encodedQuery)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || !isQueryValuePresent(rawValue)) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      const normalizedValue = String(value ?? "").trim();
      if (!normalizedValue) {
        continue;
      }
      searchParams.append(normalizedKey, normalizedValue);
    }
  }

  const serializedQuery = searchParams.toString();
  if (!serializedQuery) {
    return normalizedUrl;
  }

  return appendQueryString(normalizedUrl, serializedQuery);
}

/**
 * @typedef {object} HttpClientHooks
 * @property {(request: object) => void | Promise<void>} [decorateHeaders] Adds headers to a request before it is sent.
 * @property {(failure: object) => void | Promise<void>} [onFailure]
 * @property {(success: object) => void | Promise<void>} [onSuccess]
 * @property {(error: Error) => void | Promise<void>} [onUnauthorized]
 * @property {(failure: object) => void | Promise<void>} [onRetryableFailure]
 * @property {(failure: object) => boolean | null | Promise<boolean | null>} [shouldRetryRequest] null keeps the CSRF retry rule.
 * @property {(result: object) => boolean | Promise<boolean>} [shouldTreatAsNdjsonStream]
 */

/**
 * An HTTP client that sends JSON and JSON:API requests, keeps a CSRF token for
 * unsafe methods and reads NDJSON streams.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] The global fetch unless given.
 * @param {(url: string, context: object) => string | Promise<string>} [options.resolveRequestUrl]
 * @param {HttpClientHooks} [options.hooks]
 * @param {string[]} [options.unsafeMethods]
 * @param {{ enabled?: boolean, sessionPath?: string, headerName?: string, tokenField?: string, retryableErrorCodes?: string[] }} [options.csrf]
 * @param {RequestCredentials} [options.credentials]
 * @param {number} [options.readTimeoutMs]
 */
function createHttpClient({
  fetchImpl = fetchWithGlobalFetch,
  resolveRequestUrl: resolveConfiguredRequestUrl = keepRequestUrl,
  hooks = {},
  unsafeMethods: configuredUnsafeMethods = DEFAULT_UNSAFE_METHODS,
  csrf: {
    enabled: csrfEnabledByDefault = true,
    sessionPath: csrfSessionPath = "/api/session",
    headerName: csrfHeaderName = "csrf-token",
    tokenField: csrfTokenField = "csrfToken",
    retryableErrorCodes: csrfRetryableErrorCodes
  } = {},
  credentials = "same-origin",
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS
} = {}) {
  const {
    decorateHeaders: decorateConfiguredHeaders = keepHeaders,
    onFailure = ignoreRequestOutcome,
    onSuccess = ignoreRequestOutcome,
    onUnauthorized = ignoreRequestOutcome,
    onRetryableFailure = ignoreRequestOutcome,
    shouldRetryRequest = useCsrfRetryRule,
    shouldTreatAsNdjsonStream = useContentTypeForStream
  } = hooks;
  const unsafeMethods = resolveUnsafeMethods(configuredUnsafeMethods);
  const csrf = Object.freeze({
    enabled: csrfEnabledByDefault,
    sessionPath: csrfSessionPath,
    headerName: csrfHeaderName,
    tokenField: csrfTokenField,
    retryableErrorCodes: csrfRetryableErrorCodes
  });

  let csrfTokenCache = "";
  let csrfFetchPromise = null;

  function updateCsrfTokenFromPayload(data) {
    const token = String(data?.[csrf.tokenField] || "");
    if (token) {
      csrfTokenCache = token;
    }
  }

  async function fetchSessionForCsrf() {
    const signal = requestSignalWithDeadline(null, readTimeoutMs);
    const requestUrl = await resolveRequestUrl(csrf.sessionPath, {
      originalUrl: csrf.sessionPath,
      method: "GET",
      requestOptions: {
        method: "GET"
      },
      state: null,
      stream: false,
      csrfSession: true
    });
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        credentials,
        signal
      });
    } catch (cause) {
      signal.throwIfAborted();
      throw buildNetworkError(cause);
    }

    const { data } = await parseJsonSafely(response, signal);
    signal.throwIfAborted();
    updateCsrfTokenFromPayload(data);

    if (!response.ok) {
      throw buildHttpError(response, data);
    }

    return data;
  }

  async function ensureCsrfToken(forceRefresh = false) {
    if (!csrf.enabled) {
      return "";
    }

    if (!forceRefresh && csrfTokenCache) {
      return csrfTokenCache;
    }

    if (!csrfFetchPromise || forceRefresh) {
      csrfFetchPromise = fetchSessionForCsrf().finally(() => {
        csrfFetchPromise = null;
      });
    }

    await csrfFetchPromise;
    return csrfTokenCache;
  }

  async function resolveRequestUrl(url, context = {}) {
    const normalizedUrl = String(url || "").trim();
    const resolved = await resolveConfiguredRequestUrl(normalizedUrl, {
      ...context,
      url: normalizedUrl
    });
    return normalizeResolvedRequestUrl(resolved, normalizedUrl);
  }

  async function maybeRetry({ response, method, state, data, stream, csrfEnabled }) {
    if (!csrfEnabled) {
      return false;
    }

    const customShouldRetry = await shouldRetryRequest({
      response,
      method,
      state,
      data,
      stream
    });
    const shouldRetry =
      customShouldRetry == null
        ? shouldRetryForCsrfFailure({
            response,
            method,
            state,
            data,
            unsafeMethods,
            retryableErrorCodes: csrf.retryableErrorCodes
          })
        : Boolean(customShouldRetry);
    if (!shouldRetry) {
      return false;
    }

    await onRetryableFailure({
      response,
      method,
      state,
      data,
      stream
    });

    csrfTokenCache = "";
    await ensureCsrfToken(true);
    state.csrfRetried = true;
    return true;
  }

  function resolveRequestState(state) {
    const resolvedState = state && typeof state === "object" ? state : {};
    if (typeof resolvedState.csrfRetried !== "boolean") {
      resolvedState.csrfRetried = false;
    }

    return resolvedState;
  }

  async function prepareRequestConfig(url, requestOptions, state, stream) {
    const resolvedState = resolveRequestState(state);

    const method = normalizeMethod(requestOptions.method);
    const transport = normalizeJsonApiClientTransport(requestOptions.transport);
    const {
      transport: _transport,
      query: requestQuery,
      csrf: requestCsrf,
      timeoutMs: requestTimeoutMs,
      ...forwardedRequestOptions
    } = requestOptions;
    const csrfEnabled = csrf.enabled && requestCsrf !== false;
    const requestUrl = appendRequestQueryToUrl(url, requestQuery, transport);
    const resolvedRequestUrl = await resolveRequestUrl(requestUrl, {
      originalUrl: url,
      method,
      requestOptions,
      state: resolvedState,
      stream: Boolean(stream),
      csrfSession: false
    });
    const headers =
      requestOptions.headers && typeof requestOptions.headers === "object" ? { ...requestOptions.headers } : {};

    await decorateConfiguredHeaders({
      url: resolvedRequestUrl,
      method,
      headers,
      requestOptions,
      state: resolvedState,
      stream: Boolean(stream)
    });

    const config = {
      credentials,
      ...forwardedRequestOptions,
      method,
      headers
    };
    const ordinaryRead = !stream && ["GET", "HEAD"].includes(method);
    const timeoutMs = requestTimeoutMs ?? (ordinaryRead ? readTimeoutMs : undefined);
    if (timeoutMs !== undefined) {
      config.signal = requestSignalWithDeadline(config.signal, timeoutMs);
    }

    if (transport) {
      setHeaderIfMissing(headers, "Accept", JSON_API_CONTENT_TYPE);
    }

    if (transport && isObjectBody(config.body)) {
      setHeaderIfMissing(headers, "Content-Type", JSON_API_CONTENT_TYPE);
      config.body = encodeJsonApiResourceRequestBody(config.body, transport);
    }

    if (isObjectBody(config.body)) {
      setHeaderIfMissing(headers, "Content-Type", "application/json");
      config.body = JSON.stringify(config.body);
    }

    if (csrfEnabled && unsafeMethods.has(method) && !hasHeader(headers, csrf.headerName)) {
      const token = await ensureCsrfToken();
      if (token) {
        setHeaderIfMissing(headers, csrf.headerName, token);
      }
    }

    return {
      method,
      config,
      state: resolvedState,
      csrfEnabled,
      transport,
      url: resolvedRequestUrl
    };
  }

  async function executePreparedRequest(url, config, { method, state }, onNetworkFailure) {
    config.signal?.throwIfAborted();
    let response;
    try {
      response = await fetchImpl(url, config);
    } catch (cause) {
      config.signal?.throwIfAborted();
      return onNetworkFailure(cause);
    }

    const { contentType, isJson, data } = await parseJsonSafely(response, config.signal);
    config.signal?.throwIfAborted();
    updateCsrfTokenFromPayload(data);

    return {
      response,
      data,
      contentType,
      isJson,
      method,
      state
    };
  }

  async function handleHttpFailure({
    url,
    method,
    state,
    response,
    data,
    contentType,
    isJson,
    stream,
    csrfEnabled,
    retryRequest
  }) {
    if (
      await maybeRetry({
        response,
        method,
        state,
        data,
        stream,
        csrfEnabled
      })
    ) {
      return retryRequest();
    }

    const error = buildHttpError(response, data);
    if (Number(response.status) === 401) {
      await onUnauthorized(error);
    }

    await onFailure({
      url,
      method,
      state,
      reason: `http_${response.status}`,
      error,
      response,
      data,
      contentType,
      isJson,
      stream
    });
    throw error;
  }

  async function executeRequestLifecycle({
    url,
    requestOptions = {},
    state = null,
    stream = false,
    handleNetworkFailure,
    retryRequest
  }) {
    const requestContext = await prepareRequestConfig(url, requestOptions, state, stream);
    const {
      method,
      state: resolvedState
    } = requestContext;
    const result = await executePreparedRequest(
      requestContext.url,
      requestContext.config,
      requestContext,
      (cause) =>
        handleNetworkFailure({
          cause,
          url,
          method,
          state: resolvedState,
          stream
        })
    );

    if (!result.response.ok) {
      return {
        handled: true,
        value: await handleHttpFailure({
          url,
          method,
          state: resolvedState,
          response: result.response,
          data: result.data,
          contentType: result.contentType,
          isJson: result.isJson,
          stream,
          csrfEnabled: requestContext.csrfEnabled,
          retryRequest() {
            return retryRequest(resolvedState);
          }
        })
      };
    }

    return {
      handled: false,
      value: {
        method,
        state: resolvedState,
        result,
        transport: requestContext.transport
      }
    };
  }

  async function request(url, requestOptions = {}, state = null) {
    const execution = await executeRequestLifecycle({
      url,
      requestOptions,
      state,
      stream: false,
      async handleNetworkFailure({ cause, method, state: resolvedState }) {
        if (cause?.name === "AbortError") {
          throw cause;
        }
        const error = buildNetworkError(cause);
        await onFailure({
          url,
          method,
          state: resolvedState,
          reason: "network_error",
          error,
          stream: false
        });
        throw error;
      },
      retryRequest(nextState) {
        return request(url, requestOptions, nextState);
      }
    });
    if (execution.handled) {
      return execution.value;
    }

    const {
      method,
      state: resolvedState,
      result,
      transport
    } = execution.value;

    if (Number(result.response.status) === 204) {
      await onSuccess({
        url,
        method,
        state: resolvedState,
        response: result.response,
        data: null,
        rawData: null,
        contentType: result.contentType,
        isJson: result.isJson,
        stream: false
      });
      return null;
    }

    let responseData = result.data;
    if (transport) {
      try {
        responseData = decodeJsonApiResourceDocument(result.data, transport);
      } catch (cause) {
        const error = buildNetworkError(cause);
        error.message = "JSON:API response decoding failed.";
        await onFailure({
          url,
          method,
          state: resolvedState,
          reason: "transport_decode_error",
          error,
          response: result.response,
          data: result.data,
          contentType: result.contentType,
          isJson: result.isJson,
          stream: false
        });
        throw error;
      }
    }

    await onSuccess({
      url,
      method,
      state: resolvedState,
      response: result.response,
      data: responseData,
      rawData: result.data,
      contentType: result.contentType,
      isJson: result.isJson,
      stream: false
    });
    return responseData;
  }

  async function requestStream(url, requestOptions = {}, handlers = {}, state = null) {
    const { onEvent = ignoreStreamEvent, onMalformedLine = ignoreMalformedLine } = handlers;
    const lineHandlers = Object.freeze({ onEvent, onMalformedLine });
    const execution = await executeRequestLifecycle({
      url,
      requestOptions,
      state,
      stream: true,
      async handleNetworkFailure({ cause, method, state: resolvedState }) {
        const aborted = String(cause?.name || "") === "AbortError";
        const reason = aborted ? "aborted" : "network_error";
        await onFailure({
          url,
          method,
          state: resolvedState,
          reason,
          error: cause,
          stream: true
        });
        if (aborted) {
          throw cause;
        }

        throw buildNetworkError(cause);
      },
      retryRequest(nextState) {
        return requestStream(url, requestOptions, handlers, nextState);
      }
    });
    if (execution.handled) {
      return execution.value;
    }

    const {
      method,
      state: resolvedState,
      result
    } = execution.value;

    try {
      let shouldParseAsNdjson = result.contentType.includes(DEFAULT_NDJSON_CONTENT_TYPE);
      if (!shouldParseAsNdjson) {
        shouldParseAsNdjson = Boolean(
          await shouldTreatAsNdjsonStream({
            url,
            method,
            state: resolvedState,
            contentType: result.contentType,
            isJson: result.isJson,
            data: result.data,
            response: result.response
          })
        );
      }

      if (shouldParseAsNdjson) {
        await readNdjsonStream(result.response, lineHandlers);
      } else if (Object.keys(result.data).length > 0) {
        lineHandlers.onEvent(result.data);
      } else {
        await readNdjsonText(result.response, lineHandlers);
      }
    } catch (error) {
      await onFailure({
        url,
        method,
        state: resolvedState,
        reason: "stream_error",
        error,
        response: result.response,
        data: result.data,
        contentType: result.contentType,
        isJson: result.isJson,
        stream: true
      });
      throw error;
    }

    await onSuccess({
      url,
      method,
      state: resolvedState,
      response: result.response,
      data: result.data,
      contentType: result.contentType,
      isJson: result.isJson,
      stream: true
    });
  }

  function clearCsrfTokenCache() {
    csrfTokenCache = "";
  }

  return Object.freeze({
    request,
    requestStream,
    ensureCsrfToken,
    clearCsrfTokenCache
  });
}

export { createHttpClient };
