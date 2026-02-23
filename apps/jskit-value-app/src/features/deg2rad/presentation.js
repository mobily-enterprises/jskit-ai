function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatRadians(value) {
  const parsed = toFiniteNumber(value);
  if (parsed == null) {
    return "Unknown";
  }

  return `${parsed.toFixed(12)} rad`;
}

export function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

export function typeLabel(entry) {
  return String(entry?.DEG2RAD_operation || "DEG2RAD").toUpperCase();
}

export function inputSummary(entry) {
  if (!entry) {
    return "";
  }

  const degrees = toFiniteNumber(entry.DEG2RAD_degrees);
  if (degrees == null) {
    return "DEG2RAD(?)";
  }

  return `DEG2RAD(${degrees.toFixed(6)})`;
}

export function resultSummary(result) {
  if (!result) {
    return "";
  }

  return `DEG2RAD(${result.DEG2RAD_degrees}) = ${result.DEG2RAD_radians} rad`;
}

export function resultWarnings() {
  return [];
}
