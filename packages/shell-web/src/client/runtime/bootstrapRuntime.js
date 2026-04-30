import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { resolveBootstrapPayloadHandlers } from "../bootstrap/bootstrapPayloadHandlerRegistry.js";

const DEFAULT_BOOTSTRAP_PATH = "/api/bootstrap";

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildBootstrapUrl({ path = DEFAULT_BOOTSTRAP_PATH, query = {} } = {}) {
  const normalizedPath = String(path || DEFAULT_BOOTSTRAP_PATH).trim() || DEFAULT_BOOTSTRAP_PATH;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(normalizeObject(query))) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    params.set(normalizedKey, normalizedValue);
  }

  const queryString = params.toString();
  return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
}

function normalizeBootstrapResponseError(response, url) {
  const error = new Error(`Bootstrap payload request failed with status ${response.status}.`);
  error.statusCode = Number(response.status || 0);
  error.url = url;
  return error;
}

function createShellBootstrapRuntime({
  app,
  logger = null,
  fetchImplementation = globalThis.fetch,
  bootstrapPath = DEFAULT_BOOTSTRAP_PATH
} = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function" || typeof app.resolveTag !== "function") {
    throw new Error("createShellBootstrapRuntime requires application has()/make()/resolveTag().");
  }
  if (!app.has("runtime.web-placement.client")) {
    throw new Error("createShellBootstrapRuntime requires shell-web placement runtime.");
  }

  const runtimeLogger = logger || createSharedProviderLogger(app);
  const placementRuntime = app.make("runtime.web-placement.client");
  const router = app.has("jskit.client.router") ? app.make("jskit.client.router") : null;
  let initialized = false;
  let refreshQueue = Promise.resolve();

  async function resolveBootstrapRequest(reason = "manual") {
    const handlers = resolveBootstrapPayloadHandlers(app);
    let request = {
      path: bootstrapPath,
      query: {},
      meta: {}
    };

    for (const handler of handlers) {
      if (typeof handler.resolveBootstrapRequest !== "function") {
        continue;
      }

      const contribution = normalizeObject(
        await handler.resolveBootstrapRequest({
          app,
          router,
          placementRuntime,
          reason,
          request: Object.freeze({
            path: request.path,
            query: Object.freeze({ ...request.query }),
            meta: Object.freeze({ ...request.meta })
          })
        })
      );

      request = {
        path: String(contribution.path || request.path || bootstrapPath).trim() || bootstrapPath,
        query: {
          ...request.query,
          ...normalizeObject(contribution.query)
        },
        meta: {
          ...request.meta,
          ...normalizeObject(contribution.meta)
        }
      };
    }

    return Object.freeze({
      path: request.path,
      query: Object.freeze({ ...request.query }),
      meta: Object.freeze({ ...request.meta })
    });
  }

  async function applyBootstrapPayload(payload, reason = "manual", request = Object.freeze({})) {
    const handlers = resolveBootstrapPayloadHandlers(app);
    const source = `shell-web.bootstrap.${String(reason || "manual").trim() || "manual"}`;

    for (const handler of handlers) {
      await handler.applyBootstrapPayload({
        app,
        router,
        placementRuntime,
        payload,
        request,
        reason,
        source
      });
    }

    return payload;
  }

  async function applyBootstrapError(error, reason = "manual", request = Object.freeze({})) {
    const handlers = resolveBootstrapPayloadHandlers(app);
    const source = `shell-web.bootstrap.${String(reason || "manual").trim() || "manual"}`;

    for (const handler of handlers) {
      if (typeof handler.handleBootstrapError !== "function") {
        continue;
      }

      await handler.handleBootstrapError({
        app,
        router,
        placementRuntime,
        error,
        request,
        reason,
        source
      });
    }
  }

  async function performRefresh(reason = "manual") {
    if (typeof fetchImplementation !== "function") {
      throw new Error("Bootstrap payload fetch requires a fetch implementation.");
    }

    const request = await resolveBootstrapRequest(reason);
    const url = buildBootstrapUrl(request);

    try {
      const response = await fetchImplementation(url, {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json"
        }
      });

      if (!response.ok) {
        throw normalizeBootstrapResponseError(response, url);
      }

      const payload = await response.json();
      return applyBootstrapPayload(payload, reason, request);
    } catch (error) {
      await applyBootstrapError(error, reason, request);
      runtimeLogger.warn(
        {
          reason,
          error: String(error?.message || error || "unknown error")
        },
        "shell-web bootstrap refresh failed."
      );
      return null;
    }
  }

  function refresh(reason = "manual") {
    refreshQueue = refreshQueue.then(() => performRefresh(reason));
    return refreshQueue;
  }

  async function initialize() {
    if (initialized) {
      return null;
    }
    initialized = true;
    return refresh("init");
  }

  return Object.freeze({
    initialize,
    refresh
  });
}

export { createShellBootstrapRuntime };
