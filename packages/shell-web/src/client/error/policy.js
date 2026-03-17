import {
  normalizeAction,
  normalizeChannel,
  normalizeSeverity,
  normalizeText
} from "./normalize.js";

function createDefaultErrorPolicy({
  defaultChannel = "snackbar",
  unauthorizedChannel = "banner",
  serverErrorChannel = "dialog",
  defaultSeverity = "error"
} = {}) {
  const normalizedDefaultChannel = normalizeChannel(defaultChannel, "snackbar") || "snackbar";
  const normalizedUnauthorizedChannel = normalizeChannel(unauthorizedChannel, "banner") || "banner";
  const normalizedServerErrorChannel = normalizeChannel(serverErrorChannel, "dialog") || "dialog";
  const normalizedDefaultSeverity = normalizeSeverity(defaultSeverity, "error");

  return function defaultErrorPolicy(event = {}) {
    const status = Number(event.status || 0);
    const explicitChannel = normalizeChannel(event.channel);

    let channel = explicitChannel;
    if (!channel) {
      if (event.blocking === true || status >= 500) {
        channel = normalizedServerErrorChannel;
      } else if (status === 401 || status === 403) {
        channel = normalizedUnauthorizedChannel;
      } else {
        channel = normalizedDefaultChannel;
      }
    }

    const message = normalizeText(event.userMessage || event.message, "Request failed.");

    return Object.freeze({
      channel,
      message,
      severity: normalizeSeverity(event.severity, normalizedDefaultSeverity),
      presenterId: normalizeText(event.presenterId),
      action: normalizeAction(event.action),
      persist: channel !== "snackbar",
      dedupeKey: normalizeText(event.dedupeKey)
    });
  };
}

export {
  createDefaultErrorPolicy
};
