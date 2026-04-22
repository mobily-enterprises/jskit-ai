import { appendQueryString } from "@jskit-ai/kernel/shared/support";

function appendRequestQueryEntriesToPath(path = "", entries = []) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return "";
  }

  const sourceEntries = Array.isArray(entries) ? entries : [];
  const searchParams = new URLSearchParams();
  for (const entry of sourceEntries) {
    const key = String(entry?.key || "").trim();
    const values = Array.isArray(entry?.values) ? entry.values : [];
    if (!key || values.length < 1) {
      continue;
    }

    for (const value of values) {
      searchParams.append(key, value);
    }
  }

  const serializedSearch = searchParams.toString();
  if (!serializedSearch) {
    return normalizedPath;
  }

  return appendQueryString(normalizedPath, serializedSearch);
}

export { appendRequestQueryEntriesToPath };
