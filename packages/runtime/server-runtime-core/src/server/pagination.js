import { parsePositiveInteger } from "./integers.js";

function normalizePagination(pagination = {}, { defaultPage = 1, defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const rawPage = parsePositiveInteger(pagination?.page);
  const rawPageSize = parsePositiveInteger(pagination?.pageSize);

  return {
    page: rawPage || defaultPage,
    pageSize: Math.max(1, Math.min(maxPageSize, rawPageSize || defaultPageSize))
  };
}

export { normalizePagination };
