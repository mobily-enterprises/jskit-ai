import { useJskitText } from "../i18n.js";

const { t, text, formatDate } = useJskitText();
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_DISPLAY_OPTIONS = Object.freeze({
  year: "numeric",
  month: "short",
  day: "numeric"
});

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

  // An explicit locale (the date picker's) wins; otherwise the app's active
  // language, or the browser default when the app has no vue-i18n.
  try {
    return locale
      ? new Intl.DateTimeFormat(locale, DATE_DISPLAY_OPTIONS).format(date)
      : formatDate(date, DATE_DISPLAY_OPTIONS);
  } catch {
    return formatDateOnlyValue(date);
  }
}

function formatCrudListDateFilterChipLabel(filter = {}, rawValue, { locale = undefined } = {}) {
  const label = text(filter.label);
  if (filter.type === "date") {
    const dateLabel = formatDateOnlyDisplay(rawValue, { locale }) || String(rawValue || "");
    return dateLabel ? t("jskit.http.crud.filters.chipDate", { label, date: dateLabel }) : "";
  }

  if (filter.type !== "dateRange") {
    return "";
  }

  const from = formatDateOnlyDisplay(rawValue?.from, { locale }) || String(rawValue?.from || "");
  const to = formatDateOnlyDisplay(rawValue?.to, { locale }) || String(rawValue?.to || "");
  if (from && to) {
    return t("jskit.http.crud.filters.chipRange", { label, from, to });
  }
  if (from) {
    return t("jskit.http.crud.filters.chipFrom", { label, from });
  }
  return to ? t("jskit.http.crud.filters.chipTo", { label, to }) : "";
}

export {
  parseDateOnlyValue,
  formatDateOnlyValue,
  formatDateOnlyDisplay,
  formatCrudListDateFilterChipLabel
};
