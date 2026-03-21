import { createHttpError, createNetworkError } from "./errors.js";
import { hasHeader, setHeaderIfMissing } from "./headers.js";
import { DEFAULT_RETRYABLE_CSRF_ERROR_CODES, shouldRetryForCsrfFailure } from "./retry.js";

const DEFAULT_UNSAFE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_NDJSON_CONTENT_TYPE = "application/x-ndjson";

function normalizeMethod(method) {
  return String(method || "GET")
    .trim()
    .toUpperCase();
}

function resolveUnsafeMethods(value) {
  const source = Array.isArray(value) ? value : DEFAULT_UNSAFE_METHODS;
  return new Set(source.map((method) => normalizeMethod(method)).filter(Boolean));
}

function resolveFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }

  throw new Error("createHttpClient requires fetchImpl when global fetch is unavailable.");
}

function isObjectBody(value) {
  return Boolean(value) && typeof value === "object" && !(value instanceof FormData);
}

function parseJsonSafely(response) {
  const contentType = String(response?.headers?.get?.("content-type") || "");
  const isJson = contentType.includes("application/json");
  if (!isJson) {
    return Promise.resolve({
      contentType,
      isJson,
      data: {}
    });
  }

  return Promise.resolve(response?.json?.())
    .catch(() => ({}))
    .then((data) => ({
      contentType,
      isJson,
      data: data && typeof data === "object" ? data : {}
    }));
}

function emitNdjsonLine(line, handlers) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return;
  }

  try {
    const payload = JSON.parse(normalizedLine);
    if (typeof handlers?.onEvent === "function") {
      handlers.onEvent(payload);
    }
  } catch (error) {
    if (typeof handlers?.onMalformedLine === "function") {
      handlers.onMalformedLine(normalizedLine, error);
    }
  }
}

async function readNdjsonStream(response, handlers = {}) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    if (typeof response?.text === "function") {
      const rawText = await response.text().catch(() => "");
      for (const line of String(rawText || "").split(/\r?\n/g)) {
        emitNdjsonLine(line, handlers);
      }
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, {
      stream: true
    });

    const lines = buffered.split(/\r?\n/g);
    buffered = lines.pop() || "";
    for (const line of lines) {
      emitNdjsonLine(line, handlers);
    }
  }

  buffered += decoder.decode();
  if (buffered) {
    emitNdjsonLine(buffered, handlers);
  }
}

function createHttpClient(options = {}) {
  const configuredFetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : null;
  const unsafeMethods = resolveUnsafeMethods(options.unsafeMethods);
  const hooks = options?.hooks && typeof options.hooks === "object" ? options.hooks : {};

  const csrf = {
    enabled: options?.csrf?.enabled !== false,
    sessionPath: String(options?.csrf?.sessionPath || "/api/session"),
    headerName: String(options?.csrf?.headerName || "csrf-token"),
    tokenField: String(options?.csrf?.tokenField || "csrfToken"),
    retryableErrorCodes: Array.isArray(options?.csrf?.retryableErrorCodes)
      ? options.csrf.retryableErrorCodes
      : DEFAULT_RETRYABLE_CSRF_ERROR_CODES
  };

  let csrfTokenCache = "";
  let csrfFetchPromise = null;

  function updateCsrfTokenFromPayload(data) {
    const token = String(data?.[csrf.tokenField] || "");
    if (token) {
      csrfTokenCache = token;
    }
  }

  async function fetchSessionForCsrf() {
    const activeFetch = configuredFetchImpl || resolveFetch();
    let response;
    try {
      response = await activeFetch(csrf.sessionPath, {
        method: "GET",
        credentials: String(options?.credentials || "same-origin")
      });
    } catch (cause) {
      throw createNetworkError(cause);
    }

    const { data } = await parseJsonSafely(response);
    updateCsrfTokenFromPayload(data);

    if (!response.ok) {
      throw createHttpError(response, data);
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

  function decorateHeaders({ url, method, headers, requestOptions, state, stream }) {
    if (typeof hooks.decorateHeaders !== "function") {
      return null;
    }

    return hooks.decorateHeaders({
      url,
      method,
      headers,
      requestOptions,
      state,
      stream
    });
  }

  async function notifyFailure(payload) {
    if (typeof hooks.onFailure === "function") {
      await hooks.onFailure(payload);
    }
  }

  async function notifySuccess(payload) {
    if (typeof hooks.onSuccess === "function") {
      await hooks.onSuccess(payload);
    }
  }

  async function maybeRetry({ response, method, state, data, stream }) {
    if (!csrf.enabled) {
      return false;
    }

    const customShouldRetry =
      typeof hooks.shouldRetryRequest === "function"
        ? await hooks.shouldRetryRequest({
            response,
            method,
            state,
            data,
            stream
          })
        : null;
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

    if (typeof hooks.onRetryableFailure === "function") {
      await hooks.onRetryableFailure({
        response,
        method,
        state,
        data,
        stream
      });
    }

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
    const headers =
      requestOptions.headers && typeof requestOptions.headers === "object" ? { ...requestOptions.headers } : {};

    const decorateHeadersResult = decorateHeaders({
      url,
      method,
      headers,
      requestOptions,
      state: resolvedState,
      stream: Boolean(stream)
    });
    if (decorateHeadersResult && typeof decorateHeadersResult.then === "function") {
      await decorateHeadersResult;
    }

    const config = {
      credentials: String(options?.credentials || "same-origin"),
      ...requestOptions,
      method,
      headers
    };

    if (isObjectBody(config.body)) {
      setHeaderIfMissing(headers, "Content-Type", "application/json");
      config.body = JSON.stringify(config.body);
    }

    if (csrf.enabled && unsafeMethods.has(method) && !hasHeader(headers, csrf.headerName)) {
      const token = await ensureCsrfToken();
      if (token) {
        setHeaderIfMissing(headers, csrf.headerName, token);
      }
    }

    return {
      method,
      config,
      state: resolvedState
    };
  }

  async function executePreparedRequest(url, config, { method, state }, onNetworkFailure) {
    let response;
    try {
      const activeFetch = configuredFetchImpl || resolveFetch();
      response = await activeFetch(url, config);
    } catch (cause) {
      return onNetworkFailure(cause);
    }

    const { contentType, isJson, data } = await parseJsonSafely(response);
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
    retryRequest
  }) {
    if (
      await maybeRetry({
        response,
        method,
        state,
        data,
        stream
      })
    ) {
      return retryRequest();
    }

    const error = createHttpError(response, data);
    if (Number(response.status) === 401 && typeof hooks.onUnauthorized === "function") {
      await hooks.onUnauthorized(error);
    }

    await notifyFailure({
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
  } = {}) {
    if (typeof handleNetworkFailure !== "function") {
      throw new TypeError("executeRequestLifecycle requires handleNetworkFailure().");
    }
    if (typeof retryRequest !== "function") {
      throw new TypeError("executeRequestLifecycle requires retryRequest().");
    }

    const requestContext = await prepareRequestConfig(url, requestOptions, state, stream);
    const {
      method,
      state: resolvedState
    } = requestContext;
    const result = await executePreparedRequest(
      url,
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
        result
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
        const error = createNetworkError(cause);
        await notifyFailure({
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
      result
    } = execution.value;

    await notifySuccess({
      url,
      method,
      state: resolvedState,
      response: result.response,
      data: result.data,
      contentType: result.contentType,
      isJson: result.isJson,
      stream: false
    });
    return result.data;
  }

  async function requestStream(url, requestOptions = {}, handlers = {}, state = null) {
    const execution = await executeRequestLifecycle({
      url,
      requestOptions,
      state,
      stream: true,
      async handleNetworkFailure({ cause, method, state: resolvedState }) {
        const aborted = String(cause?.name || "") === "AbortError";
        const reason = aborted ? "aborted" : "network_error";
        await notifyFailure({
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

        throw createNetworkError(cause);
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
      if (!shouldParseAsNdjson && typeof hooks.shouldTreatAsNdjsonStream === "function") {
        shouldParseAsNdjson = Boolean(
          await hooks.shouldTreatAsNdjsonStream({
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
        await readNdjsonStream(result.response, handlers);
      } else if (typeof handlers?.onEvent === "function" && Object.keys(result.data).length > 0) {
        handlers.onEvent(result.data);
      } else if (typeof handlers?.onEvent === "function" && typeof result.response?.text === "function") {
        const rawText = await result.response.text().catch(() => "");
        for (const line of String(rawText || "").split(/\r?\n/g)) {
          emitNdjsonLine(line, handlers);
        }
      }
    } catch (error) {
      await notifyFailure({
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

    await notifySuccess({
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

  function resetForTests() {
    csrfTokenCache = "";
    csrfFetchPromise = null;
  }

  function get(url, requestOptions = {}) {
    return request(url, {
      ...requestOptions,
      method: "GET"
    });
  }

  function post(url, body, requestOptions = {}) {
    return request(url, {
      ...requestOptions,
      method: "POST",
      body
    });
  }

  function put(url, body, requestOptions = {}) {
    return request(url, {
      ...requestOptions,
      method: "PUT",
      body
    });
  }

  function patch(url, body, requestOptions = {}) {
    return request(url, {
      ...requestOptions,
      method: "PATCH",
      body
    });
  }

  function del(url, requestOptions = {}) {
    return request(url, {
      ...requestOptions,
      method: "DELETE"
    });
  }

  return {
    request,
    requestStream,
    ensureCsrfToken,
    clearCsrfTokenCache,
    resetForTests,
    get,
    post,
    put,
    patch,
    delete: del,
    __testables: {
      fetchSessionForCsrf,
      updateCsrfTokenFromPayload,
      createHttpError,
      createNetworkError,
      readNdjsonStream
    }
  };
}

export { createHttpClient };
