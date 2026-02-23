function toInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function normalizePage(value, fallback = 1) {
  return Math.max(1, toInteger(value, fallback));
}

export function normalizePageSize(value, fallback = 10) {
  return Math.max(1, toInteger(value, fallback));
}

export function getPreviousPage({ page, isLoading = false }) {
  const currentPage = normalizePage(page);
  if (isLoading || currentPage <= 1) {
    return currentPage;
  }

  return currentPage - 1;
}

export function getNextPage({ page, totalPages, isLoading = false }) {
  const currentPage = normalizePage(page);
  const maxPage = normalizePage(totalPages);

  if (isLoading || currentPage >= maxPage) {
    return currentPage;
  }

  return currentPage + 1;
}

export function getFirstPage() {
  return 1;
}
