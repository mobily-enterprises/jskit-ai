import { reactive } from "vue";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

function attachmentUploadError(attachment = {}) {
  return attachment?.error || attachment?.errors?.[0]?.message || "";
}

function attachmentIdentity(attachment = {}) {
  return String(
    attachment?.clientId ||
    attachment?.attachmentId ||
    attachment?.path ||
    attachment?.fileName ||
    ""
  );
}

// readable-check: allow module-state - shared resource: every queue on the page draws client ids from one sequence, so no two queues hand out the same id
let attachmentClientSequence = 0;

function nextAttachmentClientId() {
  attachmentClientSequence += 1;
  return `attachment-${Date.now().toString(36)}-${attachmentClientSequence.toString(36)}`;
}

function attachmentFileName(file = {}) {
  return String(file?.name || "attachment");
}

/** The upload's promise and its cancel, whichever of the documented shapes the application's upload returned. */
// readable-check: allow method-probe - input validation: an application's upload returns a promise, or { promise } with abort() or cancel()
function attachmentUploadResult(upload = null) {
  if (upload && typeof upload.then === "function") {
    return {
      cancel: typeof upload.cancel === "function" ? () => upload.cancel() : null,
      promise: upload
    };
  }
  if (upload?.promise && typeof upload.promise.then === "function") {
    const cancel = typeof upload.abort === "function"
      ? () => upload.abort()
      : typeof upload.cancel === "function"
        ? () => upload.cancel()
        : null;
    return {
      cancel,
      promise: upload.promise
    };
  }
  return {
    cancel: null,
    promise: Promise.resolve(upload)
  };
}

function attachmentProgress(progress = {}, possibleTotal, fallbackTotal = 0) {
  const directNumericProgress = typeof progress === "number" ? progress : null;
  const progressObject = progress && typeof progress === "object" ? progress : {};
  const totalBytes = Math.max(0, Number(
    progressObject.totalBytes ??
    progressObject.total ??
    possibleTotal ??
    fallbackTotal
  ) || 0);
  const bytesValue = progressObject.bytesSent ??
    progressObject.loaded ??
    progressObject.uploadedBytes ??
    directNumericProgress;
  const bytesKnown = bytesValue !== null && bytesValue !== undefined && bytesValue !== "";
  let bytesSent = bytesKnown ? Number(bytesValue) || 0 : 0;
  const directPercent = progressObject.percent;
  let percent = directPercent !== null && directPercent !== undefined && directPercent !== ""
    ? Number(directPercent)
    : null;
  const progressValue = progressObject.progress;
  if (!Number.isFinite(percent) && progressValue !== null && progressValue !== undefined && progressValue !== "") {
    const numericProgressValue = Number(progressValue);
    if (Number.isFinite(numericProgressValue)) {
      percent = numericProgressValue <= 1 ? numericProgressValue * 100 : numericProgressValue;
    }
  }
  if (!Number.isFinite(percent)) {
    percent = bytesKnown && totalBytes > 0 ? (bytesSent / totalBytes) * 100 : null;
  }
  if (percent !== null) {
    percent = Math.max(0, Math.min(100, percent));
  }
  if (totalBytes > 0) {
    const inferredBytes = percent === null ? 0 : totalBytes * percent / 100;
    bytesSent = Math.max(0, Math.min(totalBytes, bytesSent || inferredBytes));
  } else {
    bytesSent = Math.max(0, bytesSent);
  }
  return {
    bytesSent,
    percent,
    totalBytes
  };
}

function attachmentReceipt(row, uploaded = {}) {
  return {
    ...uploaded,
    attachmentId: String(uploaded?.attachmentId || ""),
    clientId: row.clientId,
    fileName: String(uploaded?.fileName || row.fileName),
    sessionId: row.sessionId,
    size: Number(uploaded?.size ?? row.size) || 0
  };
}

function createWaiter(row) {
  let resolve = null;
  const promise = new Promise((currentResolve) => {
    resolve = currentResolve;
  });
  row.waiter = {
    promise,
    resolve,
    settled: false
  };
  return row.waiter;
}

function settleWaiter(row, value = null, waiter = row.waiter) {
  if (!waiter || waiter.settled) {
    return;
  }
  waiter.settled = true;
  waiter.resolve(value);
}


function updateRowProgress(row, progress, total) {
  if (!row.retained || row.phase !== "uploading") {
    return;
  }
  const next = attachmentProgress(progress, total, row.totalBytes);
  row.bytesSent = Math.max(row.bytesSent, next.bytesSent);
  row.totalBytes = next.totalBytes || row.totalBytes;
  if (next.percent !== null) {
    row.progress = Math.max(Number(row.progress) || 0, next.percent);
  }
}

/** A new queue row for one file, or for a file a producer is still preparing. */
function buildQueueRow({
  currentSessionId,
  file = null,
  fileName = "attachment",
  phase = "queued",
  producer = null,
  size = 0
} = {}) {
  const normalizedSize = Number(file?.size ?? size) || 0;
  return reactive({
    activeHandoffToken: null,
    activeToken: null,
    attachmentId: "",
    bytesSent: 0,
    clientId: nextAttachmentClientId(),
    error: "",
    failureStage: "",
    file,
    fileName: file ? attachmentFileName(file) : String(fileName || "attachment"),
    path: "",
    phase,
    producer,
    producerAbortController: null,
    producerToken: null,
    progress: null,
    receipt: null,
    retained: true,
    sessionId: currentSessionId,
    size: normalizedSize,
    totalBytes: normalizedSize,
    waiter: null
  });
}

/**
 * Deletes an uploaded file that no message will send, once per receipt, and waits for the deletions under way.
 * A failed deletion is reported and resolves false.
 * @param {{
 *   deleteAttachment?: import("../types.js").AssistantAttachmentDeletion,
 *   deletesUnsentUploads: boolean,
 *   reportAttachmentError: (error: unknown, fallbackMessage: string) => string
 * }} dependencies
 */
function createReceiptCleanup({ deleteAttachment, deletesUnsentUploads, reportAttachmentError }) {
  const cleanupTasks = new Set();
  const receiptCleanupById = new Map();
  const cleanedReceiptIds = new Set();

  function trackCleanup(task) {
    const cleanup = Promise.resolve(task).catch((error) => {
      reportAttachmentError(error, t("jskit.assistant.attachments.error.cleanupFailed"));
      return false;
    });
    cleanupTasks.add(cleanup);
    cleanup.finally(() => cleanupTasks.delete(cleanup));
    return cleanup;
  }

  async function deleteUploadedAttachment(currentSessionId, attachment = {}) {
    const attachmentId = String(attachment?.attachmentId || "").trim();
    if (!attachmentId || !deletesUnsentUploads) {
      return false;
    }
    const response = await deleteAttachment(currentSessionId, attachmentId);
    if (response?.ok === false) {
      throw new Error(attachmentUploadError(response) || t("jskit.assistant.attachments.error.cleanupFailed"));
    }
    return true;
  }

  function cleanupReceipt(currentSessionId, receipt = {}) {
    const attachmentId = String(receipt?.attachmentId || "").trim();
    const cleanupId = `${currentSessionId}:${attachmentId}`;
    if (!attachmentId) {
      return Promise.resolve(false);
    }
    if (cleanedReceiptIds.has(cleanupId)) {
      return Promise.resolve(false);
    }
    if (receiptCleanupById.has(cleanupId)) {
      return receiptCleanupById.get(cleanupId);
    }
    const cleanup = trackCleanup(deleteUploadedAttachment(currentSessionId, receipt)).then((deleted) => {
      if (deleted) {
        cleanedReceiptIds.add(cleanupId);
      }
      return deleted;
    });
    receiptCleanupById.set(cleanupId, cleanup);
    cleanup.finally(() => receiptCleanupById.delete(cleanupId));
    return cleanup;
  }

  async function waitForAttachmentCleanup() {
    while (cleanupTasks.size > 0) {
      await Promise.allSettled([...cleanupTasks]);
    }
  }

  return Object.freeze({
    cleanupReceipt,
    waitForAttachmentCleanup
  });
}

export {
  attachmentFileName,
  attachmentIdentity,
  attachmentReceipt,
  attachmentUploadError,
  attachmentUploadResult,
  buildQueueRow,
  createReceiptCleanup,
  createWaiter,
  settleWaiter,
  updateRowProgress
};
