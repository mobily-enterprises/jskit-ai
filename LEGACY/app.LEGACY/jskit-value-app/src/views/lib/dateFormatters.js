function formatDateTime(value, { invalidLabel = "unknown" } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return invalidLabel;
  }

  return date.toLocaleString();
}

export { formatDateTime };
