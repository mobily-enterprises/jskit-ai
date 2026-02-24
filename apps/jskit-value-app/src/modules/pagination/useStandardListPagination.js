import { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";

function resolveKeyPrefix(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("useStandardListPagination requires a non-empty keyPrefix.");
  }

  return normalized;
}

function resolvePageSizeOptions(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("useStandardListPagination requires a non-empty pageSizeOptions array.");
  }

  return value;
}

export function useStandardListPagination({ keyPrefix, initialPageSize, pageSizeOptions }) {
  const normalizedKeyPrefix = resolveKeyPrefix(keyPrefix);
  const normalizedPageSizeOptions = resolvePageSizeOptions(pageSizeOptions);

  return useUrlListPagination({
    pageKey: `${normalizedKeyPrefix}Page`,
    pageSizeKey: `${normalizedKeyPrefix}PageSize`,
    initialPageSize,
    defaultPageSize: normalizedPageSizeOptions[0],
    pageSizeOptions: normalizedPageSizeOptions
  });
}
