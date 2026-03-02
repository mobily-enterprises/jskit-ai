function toProviderStatusCode(error, fallback = null) {
  const statusCandidates = [error?.statusCode, error?.status, fallback];
  let parsed = null;

  for (const candidate of statusCandidates) {
    if (candidate == null || candidate === "") {
      continue;
    }
    const normalized = Number(candidate);
    if (Number.isInteger(normalized) && normalized >= 100) {
      parsed = normalized;
      break;
    }
  }

  if (parsed == null) {
    return null;
  }
  return parsed;
}

export { toProviderStatusCode };
