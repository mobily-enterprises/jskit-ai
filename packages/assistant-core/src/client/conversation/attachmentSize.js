import { useJskitText } from "../i18n.js";

const { formatNumber, t } = useJskitText();
const WHOLE = Object.freeze({ useGrouping: false });
const ONE_DECIMAL = Object.freeze({ maximumFractionDigits: 1, minimumFractionDigits: 1, useGrouping: false });

/** A file size in the active language: bytes, then KB and MB with one decimal. */
function attachmentSizeText(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return t("jskit.assistant.attachments.sizeBytes", { size: formatNumber(bytes, WHOLE) });
  }
  if (bytes < 1024 * 1024) {
    return t("jskit.assistant.attachments.sizeKilobytes", { size: formatNumber(bytes / 1024, ONE_DECIMAL) });
  }
  return t("jskit.assistant.attachments.sizeMegabytes", { size: formatNumber(bytes / (1024 * 1024), ONE_DECIMAL) });
}

/** An upload limit: whole mebibytes when exact, otherwise decimal megabytes. */
function attachmentLimitText(maxBytes) {
  return maxBytes % (1024 * 1024) === 0
    ? t("jskit.assistant.attachments.sizeMebibytes", { size: formatNumber(maxBytes / (1024 * 1024), WHOLE) })
    : t("jskit.assistant.attachments.sizeMegabytes", { size: formatNumber(maxBytes / 1_000_000, { useGrouping: false }) });
}

export { attachmentLimitText, attachmentSizeText };
