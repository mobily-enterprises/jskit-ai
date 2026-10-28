import { AppError } from "@jskit-ai/kernel/server/runtime";

function errorStatus(error) {
  return Number(error?.status || error?.statusCode || 500);
}

// AppError details are withheld from clients when an action permission is denied.
function exposedAppErrorDetails(error) {
  if (!(error instanceof AppError) || !error.details) return undefined;
  return String(error.code || "").trim() === "ACTION_PERMISSION_DENIED" ? undefined : error.details;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The kernel error payload's translation fields: the code's params and, where one
// code covers several sentences, the sentence's own messageCode.
function errorMessageFields(error, { expose = true } = {}) {
  return {
    params: expose && isRecord(error?.params) ? error.params : {},
    ...(expose && error?.messageCode
      ? { messageCode: String(error.messageCode), messageParams: isRecord(error.messageParams) ? error.messageParams : {} }
      : {})
  };
}

export { errorStatus, exposedAppErrorDetails, errorMessageFields };
