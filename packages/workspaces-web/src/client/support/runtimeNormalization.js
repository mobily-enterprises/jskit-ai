function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

function normalizeWorkspaceBootstrapStatusValue(status = "", allowedStatuses = null) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (!normalizedStatus || !(allowedStatuses instanceof Set)) {
    return "";
  }
  return allowedStatuses.has(normalizedStatus) ? normalizedStatus : "";
}

export { normalizeWorkspaceBootstrapStatusValue, resolveErrorStatusCode };
