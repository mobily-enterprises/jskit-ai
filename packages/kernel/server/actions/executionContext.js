import { normalizeRequestMeta } from "./requestMeta.js";
import { normalizeLowerText, normalizeText, isRecord } from "../../shared/support/normalize.js";
import { normalizePermissionList } from "../../shared/support/permissions.js";

function copyRecord(value) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    ...value
  };
}

function normalizeActor(actor) {
  const source = copyRecord(actor);
  if (!source) {
    return null;
  }

  if (source.id == null) {
    source.id = null;
  }

  return source;
}

function normalizeTimeMeta(timeMeta) {
  const source = timeMeta && typeof timeMeta === "object" ? timeMeta : {};
  const nowValue = source.now instanceof Date ? source.now : new Date();

  return {
    now: nowValue,
    timezone: normalizeText(source.timezone),
    locale: normalizeText(source.locale)
  };
}

const RESERVED_CONTEXT_KEYS = new Set([
  "actor",
  "permissions",
  "surface",
  "channel",
  "requestMeta",
  "timeMeta"
]);

function copyPassthroughContextEntries(source = {}) {
  const passthrough = {};
  for (const [key, value] of Object.entries(source)) {
    if (RESERVED_CONTEXT_KEYS.has(key)) {
      continue;
    }
    passthrough[key] = value;
  }
  return passthrough;
}

/**
 * An execution's channel: the one it names, else "internal".
 * @param {unknown} value
 */
function normalizeActionChannel(value) {
  return normalizeLowerText(value) || "internal";
}

function normalizeExecutionContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const passthrough = copyPassthroughContextEntries(source);

  return Object.freeze({
    ...passthrough,
    actor: normalizeActor(source.actor),
    permissions: normalizePermissionList(source.permissions),
    surface: normalizeLowerText(source.surface),
    channel: normalizeActionChannel(source.channel),
    requestMeta: normalizeRequestMeta(source.requestMeta),
    timeMeta: normalizeTimeMeta(source.timeMeta)
  });
}

export { normalizeActionChannel, normalizeExecutionContext };
