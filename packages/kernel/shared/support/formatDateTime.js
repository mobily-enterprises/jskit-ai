function formatDateTime(value, { fallback = "unknown" } = {}) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return fallback;
  }

  return parsedDate.toLocaleString();
}

export { formatDateTime };
