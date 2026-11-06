// How the attachment queue shows each item: its key, name, phase, progress, status text, icon and colour.
import { useJskitText } from "../i18n.js";
import { attachmentSizeText } from "./attachmentSize.js";

const { t } = useJskitText();

const activePhases = new Set(["queued", "preparing", "uploading", "delivering"]);

function itemKey(item = {}) {
  return String(item.clientId || item.id || item.attachmentId || item.fileName || "attachment");
}

function itemName(item = {}) {
  return String(item.fileName || item.file?.name || t("jskit.assistant.attachments.unnamed"));
}

function itemPhase(item = {}) {
  return String(item.phase || item.status || "queued");
}

function itemPercent(item = {}) {
  if (itemPhase(item) === "ready") {
    return 100;
  }
  if (itemPhase(item) === "delivering") {
    return 100;
  }
  if (itemPhase(item) === "queued") {
    return 0;
  }
  const progressValue = item.percent ?? item.progress;
  const directPercent = progressValue === null || progressValue === undefined || progressValue === ""
    ? null
    : Number(progressValue);
  if (directPercent !== null && Number.isFinite(directPercent)) {
    return Math.min(100, Math.max(0, Math.round(directPercent)));
  }
  const size = Number(item.size) || 0;
  return size > 0 && Number(item.bytesSent) > 0
    ? Math.min(100, Math.max(0, Math.round(((Number(item.bytesSent) || 0) / size) * 100)))
    : null;
}

function itemProgressVisible(item = {}) {
  return activePhases.has(itemPhase(item));
}

function itemProgressIndeterminate(item = {}) {
  return itemProgressVisible(item) && itemPercent(item) === null;
}

function itemProgressValue(item = {}) {
  return itemPercent(item) ?? 0;
}

function itemBytesLabel(item = {}) {
  const size = Math.max(0, Number(item.size) || 0);
  const sent = Math.min(Math.max(0, Number(item.bytesSent) || 0), size);
  const percent = itemPercent(item);
  return percent === null
    ? t("jskit.assistant.attachments.bytes", { sent: attachmentSizeText(sent), size: attachmentSizeText(size) })
    : t("jskit.assistant.attachments.bytesPercent", { sent: attachmentSizeText(sent), size: attachmentSizeText(size), percent });
}

function itemStatusLabel(item = {}) {
  const labels = {
    cancelled: "jskit.assistant.attachments.status.cancelled",
    delivering: "jskit.assistant.attachments.status.delivering",
    failed: item.failureStage === "preparing"
      ? "jskit.assistant.attachments.status.preparationFailed"
      : item.failureStage === "handoff"
        ? "jskit.assistant.attachments.status.sendingFailed"
        : "jskit.assistant.attachments.status.uploadFailed",
    preparing: "jskit.assistant.attachments.status.preparing",
    queued: "jskit.assistant.attachments.status.queued",
    ready: "jskit.assistant.attachments.status.ready",
    uploading: "jskit.assistant.attachments.status.uploading"
  };
  return t(Object.hasOwn(labels, itemPhase(item)) ? labels[itemPhase(item)] : "jskit.assistant.attachments.status.queued");
}

function itemCancelable(item = {}) {
  return ["preparing", "queued", "uploading"].includes(itemPhase(item));
}

function itemIcon(item = {}) {
  if (itemPhase(item) === "ready") {
    return "$checkCircle";
  }
  if (itemPhase(item) === "failed") {
    return "$error";
  }
  return "$description";
}

function itemColor(item = {}) {
  if (itemPhase(item) === "ready") {
    return "success";
  }
  if (itemPhase(item) === "failed") {
    return "error";
  }
  return "primary";
}

export {
  activePhases,
  itemBytesLabel,
  itemCancelable,
  itemColor,
  itemIcon,
  itemKey,
  itemName,
  itemPercent,
  itemPhase,
  itemProgressIndeterminate,
  itemProgressValue,
  itemProgressVisible,
  itemStatusLabel
};
