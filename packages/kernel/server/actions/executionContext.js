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

// Every entry but the reserved ones passes through, symbol-keyed ones too: background work's contexts carry private
// symbol markers (a system context's, a job context's), and dropping them would leave an action a job runs reading
// as an anonymous request. A marker passes on only what the caller's context already had.
function copyPassthroughContextEntries(source = {}) {
  const passthrough = { ...source };
  for (const key of RESERVED_CONTEXT_KEYS) {
    delete passthrough[key];
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
