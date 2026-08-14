import { useOperationScope } from "../internal/useOperationScope.js";

const WEB_OPERATION_ADAPTER_ID = "http-web-default";

function createWebOperationAdapter() {
  return Object.freeze({
    id: WEB_OPERATION_ADAPTER_ID,
    useOperationScope(options = {}) {
      return useOperationScope(options);
    }
  });
}

const defaultWebOperationAdapter = createWebOperationAdapter();

function resolveOperationAdapter(adapter, { context = "http-web operation adapter" } = {}) {
  if (adapter == null) {
    return defaultWebOperationAdapter;
  }

  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new TypeError(`${context} must be an object when provided.`);
  }
  if (typeof adapter.useOperationScope !== "function") {
    throw new TypeError(`${context} must expose useOperationScope(options).`);
  }

  return adapter;
}

export {
  createWebOperationAdapter,
  resolveOperationAdapter
};
