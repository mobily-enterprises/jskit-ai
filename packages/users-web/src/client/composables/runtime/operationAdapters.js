import { useOperationScope } from "../internal/useOperationScope.js";

const USERS_OPERATION_ADAPTER_ID = "users-default";

function createUsersOperationAdapter() {
  return Object.freeze({
    id: USERS_OPERATION_ADAPTER_ID,
    useOperationScope(options = {}) {
      return useOperationScope(options);
    }
  });
}

const defaultUsersOperationAdapter = createUsersOperationAdapter();

function resolveOperationAdapter(adapter, { context = "users-web operation adapter" } = {}) {
  if (adapter == null) {
    return defaultUsersOperationAdapter;
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
  createUsersOperationAdapter,
  resolveOperationAdapter
};
