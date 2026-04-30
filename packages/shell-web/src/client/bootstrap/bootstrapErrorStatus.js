function resolveBootstrapErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

export { resolveBootstrapErrorStatusCode };
