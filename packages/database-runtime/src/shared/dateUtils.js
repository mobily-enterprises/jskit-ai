function normalizeDateInput(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toDateOrThrow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
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
