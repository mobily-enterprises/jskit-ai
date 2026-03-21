import { normalizeRequestMeta } from "./requestMeta.js";
import { normalizeLowerText, normalizeText } from "./textNormalization.js";

function normalizePermissions(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((entry) => normalizeText(entry)).filter(Boolean)));
}

function copyRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

  if (!Object.prototype.hasOwnProperty.call(source, "id")) {
    source.id = null;
  } else if (source.id == null) {
    source.id = null;
  }

  return source;
}

function normalizeMembership(membership) {
  return copyRecord(membership);
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
  "membership",
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

function normalizeExecutionContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const passthrough = copyPassthroughContextEntries(source);

  return Object.freeze({
    ...passthrough,
    actor: normalizeActor(source.actor),
    membership: normalizeMembership(source.membership),
    permissions: normalizePermissions(source.permissions),
    surface: normalizeLowerText(source.surface),
    channel: normalizeLowerText(source.channel) || "internal",
    requestMeta: normalizeRequestMeta(source.requestMeta),
    timeMeta: normalizeTimeMeta(source.timeMeta)
  });
}

const __testables = {
  normalizeText,
  normalizeLowerText,
  normalizePermissions,
  copyRecord,
  normalizeActor,
  normalizeMembership,
  normalizeRequestMeta,
  normalizeTimeMeta
};

export { normalizeExecutionContext, __testables };
