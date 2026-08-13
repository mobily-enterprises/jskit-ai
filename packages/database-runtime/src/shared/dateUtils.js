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

function requireValidDateParts(year, month, day) {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !Number.isInteger(year) || year < 0 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > daysByMonth[month - 1]
  ) {
    throw new TypeError("Invalid date value.");
  }
}

function requireValidTimeParts(hours, minutes, seconds = 0) {
  if (
    !Number.isInteger(hours) || hours < 0 || hours > 23 ||
    !Number.isInteger(minutes) || minutes < 0 || minutes > 59 ||
    !Number.isInteger(seconds) || seconds < 0 || seconds > 59
  ) {
    throw new TypeError("Invalid time value.");
  }
}

function parseDateParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new TypeError("Invalid date value.");
  }
  const parts = match.slice(1).map(Number);
  requireValidDateParts(parts[0], parts[1], parts[2]);
  return parts;
}

function normalizeTemporalPrecision(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Invalid temporal precision.");
  }
  return value;
}

function formatFraction(milliseconds, temporalPrecision) {
  const precision = normalizeTemporalPrecision(temporalPrecision);
  if (precision === 0) {
    return "";
  }

  const millisecondDigits = pad(milliseconds, 3);
  if (precision === undefined || precision === 3) {
    return `.${millisecondDigits}`;
  }
  if (precision < 3) {
    const discardedUnit = 10 ** (3 - precision);
    if (milliseconds % discardedUnit !== 0) {
      throw new TypeError("Temporal value exceeds configured precision.");
    }
    return `.${millisecondDigits.slice(0, precision)}`;
  }
  return `.${millisecondDigits}${"0".repeat(precision - 3)}`;
}

function requireAllowedFraction(fraction, temporalPrecision) {
  const precision = normalizeTemporalPrecision(temporalPrecision);
  if (precision !== undefined && fraction && fraction.length - 1 > precision) {
    throw new TypeError("Temporal value exceeds configured precision.");
  }
}

function toJsonDate(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const date = toDateOrThrow(value);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  const normalized = String(value).trim();
  parseDateParts(normalized);
  return normalized;
}

function toJsonTime(value, { temporalPrecision } = {}) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const date = toDateOrThrow(value);
    return [
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
      formatFraction(date.getUTCMilliseconds(), temporalPrecision)
    ].join("");
  }

  const normalized = String(value).trim();
  const match = normalized.match(/^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?$/u);
  if (!match) {
    throw new TypeError("Invalid time value.");
  }
  requireValidTimeParts(Number(match[1]), Number(match[2]), Number(match[3] || 0));
  requireAllowedFraction(match[4], temporalPrecision);
  return normalized;
}

function toJsonDateTime(value, { temporalPrecision } = {}) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const date = toDateOrThrow(value);
    const year = date.getUTCFullYear();
    if (year < 0 || year > 9999) {
      throw new TypeError("Invalid date-time value.");
    }
    return [
      `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
      formatFraction(date.getUTCMilliseconds(), temporalPrecision),
      "Z"
    ].join("");
  }

  const normalized = String(value).trim();
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/u
  );
  if (!match) {
    throw new TypeError("Invalid date-time value.");
  }

  requireValidDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  requireValidTimeParts(Number(match[4]), Number(match[5]), Number(match[6]));
  requireAllowedFraction(match[7], temporalPrecision);
  const offset = match[8] || "";
  if (offset && offset !== "Z") {
    const [offsetHours, offsetMinutes] = offset.slice(1).split(":").map(Number);
    requireValidTimeParts(offsetHours, offsetMinutes, 0);
  }

  if (normalized.includes("T") && offset) {
    return normalized;
  }
  if (offset) {
    return `${normalized.slice(0, 10)}T${normalized.slice(11)}`;
  }
  return `${normalized.slice(0, 10)}T${normalized.slice(11)}Z`;
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

export {
  normalizeDateInput,
  toIsoString,
  toInsertDateTime,
  toNullableDateTime,
  toDatabaseDateTimeUtc,
  toJsonDate,
  toJsonTime,
  toJsonDateTime
};
