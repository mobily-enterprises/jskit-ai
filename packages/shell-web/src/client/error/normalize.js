import {
  isRecord,
  normalizeText as normalizeKernelText
} from "@jskit-ai/kernel/shared/support/normalize";

const ERROR_CHANNELS = Object.freeze(["snackbar", "banner", "dialog", "silent"]);
const ERROR_SEVERITIES = Object.freeze(["info", "success", "warning", "error", "critical"]);
const ERROR_INTENTS = Object.freeze(["resource-load", "action-feedback", "app-recoverable", "blocking"]);

function normalizeText(value, fallback = "") {
  return normalizeKernelText(value, {
    fallback: String(fallback || "").trim()
  });
}

function normalizeChannel(value, fallback = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (ERROR_CHANNELS.includes(normalized)) {
    return normalized;
  }
  return normalizeText(fallback).toLowerCase();
}

function normalizeSeverity(value, fallback = "error") {
  const normalized = normalizeText(value).toLowerCase();
  if (ERROR_SEVERITIES.includes(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (ERROR_SEVERITIES.includes(normalizedFallback)) {
    return normalizedFallback;
  }

  return "error";
}

function normalizeErrorIntent(value, fallback = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (ERROR_INTENTS.includes(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (ERROR_INTENTS.includes(normalizedFallback)) {
    return normalizedFallback;
  }

  return "";
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return Math.max(0, Number(fallback || 0));
  }
  if (numericValue < 0) {
    return 0;
  }
  return Math.trunc(numericValue);
}

function normalizeAction(value) {
  const source = isRecord(value) ? value : null;
  if (!source) {
    return null;
  }

  const label = normalizeText(source.label);
  const handler = typeof source.handler === "function" ? source.handler : null;
  if (!label || !handler) {
    return null;
  }

  return Object.freeze({
    label,
    handler,
    dismissOnRun: source.dismissOnRun !== false
  });
}

export {
  ERROR_CHANNELS,
  ERROR_SEVERITIES,
  ERROR_INTENTS,
  isRecord,
  normalizeText,
  normalizeChannel,
  normalizeSeverity,
  normalizeErrorIntent,
  normalizeNonNegativeInteger,
  normalizeAction
};
