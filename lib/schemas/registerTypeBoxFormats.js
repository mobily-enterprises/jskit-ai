import { Format } from "typebox/format";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isStrictUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isStrictIsoUtcDateTime(value) {
  if (typeof value !== "string" || !ISO_UTC_DATE_TIME_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString() === value;
}

export function registerTypeBoxFormats() {
  if (!Format.Has("uuid")) {
    Format.Set("uuid", isStrictUuid);
  }

  if (!Format.Has("iso-utc-date-time")) {
    Format.Set("iso-utc-date-time", isStrictIsoUtcDateTime);
  }
}
