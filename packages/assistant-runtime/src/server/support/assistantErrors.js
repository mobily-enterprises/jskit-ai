import { AppError } from "@jskit-ai/kernel/server/runtime";

function errorStatus(error) {
  return Number(error?.status || error?.statusCode || 500);
}

// AppError details are withheld from clients when an action permission is denied.
function exposedAppErrorDetails(error) {
  if (!(error instanceof AppError) || !error.details) return undefined;
  return String(error.code || "").trim() === "ACTION_PERMISSION_DENIED" ? undefined : error.details;
}

export { errorStatus, exposedAppErrorDetails };
