// A handler that shapes the request or answers failures supplies these; every other handler has them too.
function contributeNoBootstrapRequest() {
  return {};
}

function ignoreBootstrapError() {}

function normalizeBootstrapPayloadHandler(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      handlerId: String(entry.name || "anonymous"),
      order: 0,
      applyBootstrapPayload: entry,
      resolveBootstrapRequest: contributeNoBootstrapRequest,
      handleBootstrapError: ignoreBootstrapError
    });
  }

  const handlerId = String(entry.handlerId || "").trim();
  if (!handlerId) {
    throw new TypeError("Bootstrap payload handlers require handlerId.");
  }

  return Object.freeze({
    ...entry,
    handlerId,
    order: Number.isFinite(entry.order) ? Number(entry.order) : 0,
    resolveBootstrapRequest: entry.resolveBootstrapRequest || contributeNoBootstrapRequest,
    handleBootstrapError: entry.handleBootstrapError || ignoreBootstrapError
  });
}

function createBootstrapPayloadHandlerRegistry() {
  const handlers = new Map();

  function register(entry) {
    const handler = normalizeBootstrapPayloadHandler(entry);
    if (handlers.has(handler.handlerId)) {
      throw new Error(`Bootstrap payload handler "${handler.handlerId}" is duplicated.`);
    }
    handlers.set(handler.handlerId, handler);
    return api;
  }

  function list() {
    return Object.freeze(
      [...handlers.values()].sort((left, right) => {
        if (left.order !== right.order) {
          return left.order - right.order;
        }
        return left.handlerId.localeCompare(right.handlerId);
      })
    );
  }

  const api = Object.freeze({ register, list });
  return api;
}

export {
  createBootstrapPayloadHandlerRegistry,
  normalizeBootstrapPayloadHandler
};
