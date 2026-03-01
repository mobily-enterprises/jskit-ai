import { useListRuntime } from "./useListRuntime.js";
import { useViewRuntime } from "./useViewRuntime.js";
import { useMutationRuntime } from "./useMutationRuntime.js";

function createCrudRuntime(base = {}) {
  const { list, view, create, update, remove, handleUnauthorizedError, mapError } = base;

  return {
    useList(options = {}) {
      return useListRuntime({
        ...list,
        ...options,
        handleUnauthorizedError: options.handleUnauthorizedError || handleUnauthorizedError,
        mapError: options.mapError || mapError
      });
    },
    useView(options = {}) {
      return useViewRuntime({
        ...view,
        ...options,
        handleUnauthorizedError: options.handleUnauthorizedError || handleUnauthorizedError,
        mapError: options.mapError || mapError
      });
    },
    useCreate(options = {}) {
      return useMutationRuntime({
        ...create,
        ...options,
        handleUnauthorizedError: options.handleUnauthorizedError || handleUnauthorizedError,
        mapError: options.mapError || mapError
      });
    },
    useUpdate(options = {}) {
      return useMutationRuntime({
        ...update,
        ...options,
        handleUnauthorizedError: options.handleUnauthorizedError || handleUnauthorizedError,
        mapError: options.mapError || mapError
      });
    },
    useRemove(options = {}) {
      return useMutationRuntime({
        ...remove,
        ...options,
        handleUnauthorizedError: options.handleUnauthorizedError || handleUnauthorizedError,
        mapError: options.mapError || mapError
      });
    }
  };
}

export { createCrudRuntime };
