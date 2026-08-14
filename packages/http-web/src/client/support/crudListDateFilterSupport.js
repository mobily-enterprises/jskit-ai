const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseDateOnlyValue(value = "") {
  const match = DATE_ONLY_PATTERN.exec(String(value || "").trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateOnlyValue(value = null) {
  const source = Array.isArray(value) ? value[0] : value;
  const date = source instanceof Date
    ? source
    : parseDateOnlyValue(source);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  if (year < 0 || year > 9999) {
    return "";
  }

  return [
    String(year).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDateOnlyDisplay(value = "", { locale = undefined } = {}) {
  const date = parseDateOnlyValue(value);
  if (!date) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  } catch {
    return formatDateOnlyValue(date);
  }
}

function formatCrudListDateFilterChipLabel(filter = {}, rawValue, { locale = undefined } = {}) {
  if (filter.type === "date") {
    const dateLabel = formatDateOnlyDisplay(rawValue, { locale }) || String(rawValue || "");
    return dateLabel ? `${filter.label}: ${dateLabel}` : "";
  }

  if (filter.type !== "dateRange") {
    return "";
  }

  const from = formatDateOnlyDisplay(rawValue?.from, { locale }) || String(rawValue?.from || "");
  const to = formatDateOnlyDisplay(rawValue?.to, { locale }) || String(rawValue?.to || "");
  if (from && to) {
    return `${filter.label}: ${from} to ${to}`;
  }
  if (from) {
    return `${filter.label}: from ${from}`;
  }
  return to ? `${filter.label}: to ${to}` : "";
}

export {
  parseDateOnlyValue,
  formatDateOnlyValue,
  formatDateOnlyDisplay,
  formatCrudListDateFilterChipLabel
};
