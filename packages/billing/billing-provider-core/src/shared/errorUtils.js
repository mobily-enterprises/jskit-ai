function toProviderStatusCode(error, fallback = null) {
  const parsed = Number(error?.statusCode || error?.status || fallback || 0);
  if (!Number.isInteger(parsed) || parsed < 100) {
    return null;
  }
  return parsed;
}

export { toProviderStatusCode };
