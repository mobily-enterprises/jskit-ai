const DATABASE_UTC_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/u;
const RFC_3339_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function normalizeDateInput(value) {
  if (!value) {
    return null;
  }

  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    const normalized = value.trim();
    const databaseMatch = DATABASE_UTC_DATE_TIME_PATTERN.exec(normalized);
    const dateTime = databaseMatch
      ? `${databaseMatch[1]}T${databaseMatch[2]}Z`
      : RFC_3339_DATE_TIME_PATTERN.test(normalized)
        ? normalized
        : "";
    if (!dateTime) {
      return null;
    }
    date = new Date(dateTime);
  } else {
    return null;
  }

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toDateOrThrow(value) {
  const date = normalizeDateInput(value);
  if (!date) {
    throw new TypeError("Invalid date value.");
  }

  return date;
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function toIsoString(value) {
  return toDateOrThrow(value).toISOString();
}

function toInsertDateTime(dateLike, fallback = new Date()) {
  const normalized = normalizeDateInput(dateLike) || normalizeDateInput(fallback) || new Date();
  return toDatabaseDateTimeUtc(normalized);
}

function toNullableDateTime(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    return null;
  }
  return toDatabaseDateTimeUtc(normalized);
}

function toDatabaseDateTimeUtc(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const date = toDateOrThrow(value);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  const milliseconds = pad(date.getUTCMilliseconds(), 3);

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export { normalizeDateInput, toIsoString, toInsertDateTime, toNullableDateTime, toDatabaseDateTimeUtc };
