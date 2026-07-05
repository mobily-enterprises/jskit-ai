import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const AUTH_OPERATION_UNSUPPORTED_CODE = "AUTH_OPERATION_UNSUPPORTED";

function createUnsupportedAuthOperationError(operation, message = "") {
  const operationName = String(operation || "auth operation").trim() || "auth operation";
  return new AppError(501, message || `Auth operation "${operationName}" is not supported by the active provider.`, {
    code: AUTH_OPERATION_UNSUPPORTED_CODE,
    details: {
      operation: operationName
    }
  });
}

function throwUnsupportedAuthOperation(operation, message = "") {
  throw createUnsupportedAuthOperationError(operation, message);
}

function isUnsupportedAuthOperationError(error) {
  return String(error?.code || "") === AUTH_OPERATION_UNSUPPORTED_CODE;
}

export {
  AUTH_OPERATION_UNSUPPORTED_CODE,
  createUnsupportedAuthOperationError,
  throwUnsupportedAuthOperation,
  isUnsupportedAuthOperationError
};
