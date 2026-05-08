import {
  normalizeAction,
  normalizeChannel,
  normalizeErrorIntent,
  normalizeSeverity,
  normalizeText
} from "./normalize.js";

function createDefaultErrorPolicy({
  defaultChannel = "snackbar",
  resourceLoadChannel = "silent",
  actionFeedbackChannel = "snackbar",
  appRecoverableChannel = "banner",
  blockingChannel = "dialog",
  defaultSeverity = "error"
} = {}) {
  const normalizedDefaultChannel = normalizeChannel(defaultChannel, "snackbar") || "snackbar";
  const normalizedResourceLoadChannel = normalizeChannel(resourceLoadChannel, "silent") || "silent";
  const normalizedActionFeedbackChannel = normalizeChannel(actionFeedbackChannel, "snackbar") || "snackbar";
  const normalizedAppRecoverableChannel = normalizeChannel(appRecoverableChannel, "banner") || "banner";
  const normalizedBlockingChannel = normalizeChannel(blockingChannel, "dialog") || "dialog";
  const normalizedDefaultSeverity = normalizeSeverity(defaultSeverity, "error");

  return function defaultErrorPolicy(event = {}) {
    const explicitChannel = normalizeChannel(event.channel);
    const intent = normalizeErrorIntent(event.intent || (event.blocking === true ? "blocking" : ""));

    let channel = explicitChannel;
    if (!channel) {
      switch (intent) {
        case "resource-load":
          channel = normalizedResourceLoadChannel;
          break;
        case "action-feedback":
          channel = normalizedActionFeedbackChannel;
          break;
        case "app-recoverable":
          channel = normalizedAppRecoverableChannel;
          break;
        case "blocking":
          channel = normalizedBlockingChannel;
          break;
        default:
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
