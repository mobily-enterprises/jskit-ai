import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  toValue,
  watch
} from "vue";
import { ASSISTANT_ATTACHMENT_MAX_ITEMS } from "../../shared/conversation/attachments.js";
import { useJskitText } from "../i18n.js";
import { attachmentLimitText } from "./attachmentSize.js";
import {
  assistantAttachmentEventHasFiles,
  assistantAttachmentFiles,
  assistantAttachmentFilesFromDropEvent,
  assistantAttachmentFilesFromPasteEvent,
  assistantAttachmentFilesFromTransferItems,
  useAttachmentDropTarget
} from "./attachmentFiles.js";
import {
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
} from "./attachmentUploadRows.js";

const { serverMessage, t } = useJskitText();

// An upload or preparation failure in the active language; a thrown error keeps
// its own English when it has no translation.
function attachmentErrorText(error, fallback) {
  return String((error && typeof error === "object" && serverMessage(error)) || error?.message || error || fallback);
}

function assistantAttachmentSessionId(sessionId) {
  return String(toValue(sessionId) || "").trim();
}

function assistantAttachmentUploadAllowed(canUpload) {
  return toValue(canUpload) !== false;
}

const ASSISTANT_ATTACHMENT_MAX_BYTES = 100_000_000;
const ASSISTANT_ATTACHMENT_UPLOAD_CONCURRENCY = 2;
const ASSISTANT_ATTACHMENT_UNRESOLVED_PHASES = new Set([
  "preparing",
  "queued",
  "uploading",
  "delivering",
  "failed"
]);

/** Without an onError, an attachment failure shows only in the queue's own status. */
function keepAttachmentErrorInStatus() {}

/** Without an onUploaded, an uploaded file stays in the queue, ready to send with the next message. */
async function keepUploadedAttachmentsReady() {
  return null;
}

/**
 * Attachment upload and selection state for one composer: a bounded queue that uploads files a few at a time, hands
 * each receipt to `onUploaded`, and deletes uploaded files no message will send. The application owns storage and
 * authorization through `uploadAttachment` and `deleteAttachment`.
 * @param {{
 *   canUpload?: import("vue").MaybeRefOrGetter<boolean>,
 *   deleteAttachment?: import("../types.js").AssistantAttachmentDeletion,
 *   onError?: (error: unknown, fallbackMessage: string) => void,
 *   onUploaded?: (receipts: import("../types.js").AssistantAttachmentReceipt[]) => Promise<{ accepted?: boolean } | null>,
 *   sessionId: import("vue").MaybeRefOrGetter<string>,
 *   uploadAttachment: import("../types.js").AssistantAttachmentUpload,
 *   maxBytes?: number,
 *   maxItems?: number,
 *   uploadConcurrency?: number
 * }} options
 */
function useAssistantAttachments({
  canUpload = () => true,
  deleteAttachment,
  onError = keepAttachmentErrorInStatus,
  onUploaded = keepUploadedAttachmentsReady,
  sessionId,
  uploadAttachment,
  maxBytes = ASSISTANT_ATTACHMENT_MAX_BYTES,
  maxItems = ASSISTANT_ATTACHMENT_MAX_ITEMS,
  uploadConcurrency = ASSISTANT_ATTACHMENT_UPLOAD_CONCURRENCY
}) {
  if (![maxBytes, maxItems, uploadConcurrency].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("Attachment limits must be positive integers.");
  }
  const attachments = ref([]);
  const queueItems = ref([]);
  const status = ref("");
  const activeUploadCount = ref(0);
  const uploadQueue = [];
  const rowsById = new Map();
  const activeAttempts = new Map();
  let disposed = false;

  const uploading = computed(() => (
    activeUploadCount.value > 0 || queueItems.value.some((item) => (
      ["preparing", "uploading", "delivering"].includes(item.phase)
    ))
  ));
  const hasUnresolved = computed(() => queueItems.value.some((item) => (
    ASSISTANT_ATTACHMENT_UNRESOLVED_PHASES.has(item.phase)
  )));
  const canSubmit = computed(() => !hasUnresolved.value);
  const retainedItemCount = computed(() => queueItems.value.filter((item) => (
    item.phase !== "cancelled"
  )).length);
  const atCapacity = computed(() => retainedItemCount.value >= maxItems);
  const canAddFiles = computed(() => Boolean(
    !disposed &&
    assistantAttachmentSessionId(sessionId) &&
    assistantAttachmentUploadAllowed(canUpload) &&
    !atCapacity.value
  ));
  const aggregateProgress = computed(() => {
    const retainedItems = queueItems.value.filter((item) => item.phase !== "cancelled");
    const totalBytes = retainedItems.reduce((sum, item) => sum + item.totalBytes, 0);
    const bytesSent = retainedItems.reduce((sum, item) => sum + item.bytesSent, 0);
    return {
      bytesSent,
      percent: totalBytes > 0 ? Math.round((bytesSent / totalBytes) * 100) : 0,
      totalBytes
    };
  });

  const tooLarge = (row) => t("jskit.assistant.attachments.error.tooLarge", { fileName: row.fileName, limit: attachmentLimitText(maxBytes) });
  const tooMany = () => t("jskit.assistant.attachments.error.tooMany", { count: maxItems });

  function reportAttachmentError(error, fallbackMessage = t("jskit.assistant.attachments.error.uploadFailed"), {
    notify = true
  } = {}) {
    const message = attachmentErrorText(error, fallbackMessage);
    status.value = message;
    if (notify) {
      try {
        onError(error || new Error(message), fallbackMessage);
      } catch {
        // Feedback presentation must not replace the recoverable attachment state.
      }
    }
    return message;
  }

  function clearStatus() {
    status.value = "";
  }

  /** Marks a row failed at one stage with its error's text, which also becomes the queue's status. */
  function failRow(row, failureStage, error, fallbackMessage) {
    row.error = attachmentErrorText(error, fallbackMessage);
    row.failureStage = failureStage;
    row.phase = "failed";
    reportAttachmentError(error, fallbackMessage, { notify: false });
  }

  function canonicalRow(attachment = {}) {
    const identity = attachmentIdentity(attachment);
    return identity ? rowsById.get(identity) || queueItems.value.find((row) => (
      attachmentIdentity(row) === identity || row.attachmentId === identity
    )) : null;
  }

  // readable-check: allow method-probe - optional operation: a queue whose uploaded files are kept passes no deleteAttachment, so an upload no message sends stays stored
  const deletesUnsentUploads = typeof deleteAttachment === "function";
  const { cleanupReceipt, waitForAttachmentCleanup } = createReceiptCleanup({
    deleteAttachment,
    deletesUnsentUploads,
    reportAttachmentError
  });
  const {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    resetDragState
  } = useAttachmentDropTarget({ uploadFiles, reportAttachmentError });

  function removeReadyReceipt(row) {
    const removed = attachments.value.filter((attachment) => (
      attachment.clientId === row.clientId
    ));
    attachments.value = attachments.value.filter((attachment) => (
      attachment.clientId !== row.clientId
    ));
    return removed;
  }

  async function handOffUploadedAttachment(row, receipt, waiter = row.waiter) {
    const token = Symbol(`${row.clientId}-handoff`);
    row.activeHandoffToken = token;
    row.phase = "delivering";
    if (!attachments.value.some((attachment) => attachment.clientId === row.clientId)) {
      attachments.value.push(receipt);
    }
    try {
      const handoff = await onUploaded([receipt]);
      const accepted = handoff?.accepted === true;
      if (row.activeHandoffToken !== token || !row.retained || row.phase === "cancelled") {
        removeReadyReceipt(row);
        if (!accepted) {
          await cleanupReceipt(row.sessionId, receipt);
        }
        settleWaiter(row, null, waiter);
        return null;
      }
      row.activeHandoffToken = null;
      row.error = "";
      row.failureStage = "";
      if (accepted) {
        removeReadyReceipt(row);
        row.retained = false;
        rowsById.delete(row.clientId);
        queueItems.value = queueItems.value.filter((candidate) => candidate.clientId !== row.clientId);
        settleWaiter(row, receipt, waiter);
        return receipt;
      }
      row.phase = "ready";
      settleWaiter(row, receipt, waiter);
      return receipt;
    } catch (error) {
      if (row.activeHandoffToken !== token || !row.retained || row.phase === "cancelled") {
        await cleanupReceipt(row.sessionId, receipt);
        settleWaiter(row, null, waiter);
        return null;
      }
      row.activeHandoffToken = null;
      removeReadyReceipt(row);
      failRow(row, "handoff", error, t("jskit.assistant.attachments.error.unusable"));
      settleWaiter(row, null, waiter);
      return null;
    }
  }

  async function finishUploadAttempt(attempt, uploaded, uploadError = null) {
    activeAttempts.delete(attempt.token);
    activeUploadCount.value = activeAttempts.size;
    pumpQueue();
    const { row } = attempt;
    const isCurrentAttempt = row.activeToken === attempt.token;
    const uploadSucceeded = Boolean(
      !uploadError &&
      uploaded &&
      uploaded.ok !== false &&
      String(uploaded.attachmentId || "").trim()
    );

    if (!isCurrentAttempt || !row.retained || disposed) {
      if (uploadSucceeded) {
        await cleanupReceipt(attempt.sessionId, uploaded);
      }
      settleWaiter(row, null, attempt.waiter);
      pumpQueue();
      return;
    }

    row.activeToken = null;
    if (uploadSucceeded) {
      const receipt = attachmentReceipt(row, uploaded);
      row.receipt = receipt;
      row.attachmentId = receipt.attachmentId;
      row.path = String(receipt.path || "");
      row.bytesSent = row.totalBytes;
      row.progress = 100;
      row.error = "";
      row.failureStage = "";
      await handOffUploadedAttachment(row, receipt, attempt.waiter);
    } else {
      const error = uploadError || new Error(
        attachmentUploadError(uploaded) || t("jskit.assistant.attachments.error.uploadFailed")
      );
      failRow(row, "upload", error, t("jskit.assistant.attachments.error.uploadFailed"));
      settleWaiter(row, null, attempt.waiter);
    }
    pumpQueue();
  }

  function startUpload(row) {
    const token = Symbol(row.clientId);
    const abortController = new AbortController();
    const attempt = {
      abortController,
      cancel: null,
      row,
      sessionId: row.sessionId,
      settled: null,
      token,
      waiter: row.waiter
    };
    row.activeToken = token;
    row.phase = "uploading";
    row.error = "";
    activeAttempts.set(token, attempt);
    activeUploadCount.value = activeAttempts.size;

    try {
      const transport = attachmentUploadResult(uploadAttachment(row.sessionId, row.file, {
        onProgress: (progress, total) => updateRowProgress(row, progress, total),
        signal: abortController.signal
      }));
      attempt.cancel = transport.cancel;
      attempt.settled = transport.promise.then(
        (uploaded) => finishUploadAttempt(attempt, uploaded),
        (error) => finishUploadAttempt(attempt, null, error)
      );
    } catch (error) {
      attempt.settled = finishUploadAttempt(attempt, null, error);
    }
  }

  function pumpQueue() {
    if (disposed) {
      return;
    }
    while (activeAttempts.size < uploadConcurrency && uploadQueue.length > 0) {
      const row = uploadQueue.shift();
      if (!row?.retained || row.phase !== "queued") {
        continue;
      }
      startUpload(row);
    }
  }

  function cancelAttachment(attachment = {}) {
    const row = canonicalRow(attachment);
    if (!row || !row.retained || !["preparing", "queued", "uploading"].includes(row.phase)) {
      return false;
    }
    const token = row.activeToken;
    row.activeToken = null;
    row.activeHandoffToken = null;
    row.phase = "cancelled";
    row.error = "";
    const receipt = row.receipt;
    removeReadyReceipt(row);
    if (receipt) {
      void cleanupReceipt(row.sessionId, receipt);
    }
    row.receipt = null;
    row.failureStage = "";
    settleWaiter(row, null);
    const attempt = token ? activeAttempts.get(token) : null;
    try {
      row.producerAbortController?.abort();
      attempt?.abortController.abort();
      // readable-check: allow optional-call - optional operation: an upload that returns a bare promise has no cancel
      attempt?.cancel?.();
    } catch {
      // A cancelled transport is already detached; late success is still cleaned up.
    }
    row.producerAbortController = null;
    row.producerToken = null;
    pumpQueue();
    return true;
  }

  function retryAttachment(attachment = {}) {
    const row = canonicalRow(attachment);
    if (
      !row ||
      !row.retained ||
      !["failed", "cancelled"].includes(row.phase) ||
      row.sessionId !== assistantAttachmentSessionId(sessionId) ||
      !assistantAttachmentUploadAllowed(canUpload)
    ) {
      return Promise.resolve(null);
    }
    if (row.phase === "cancelled" && retainedItemCount.value >= maxItems) {
      reportAttachmentError(tooMany());
      return Promise.resolve(null);
    }
    if (row.failureStage === "handoff" && row.receipt) {
      row.error = "";
      row.phase = "uploading";
      const waiter = createWaiter(row);
      void handOffUploadedAttachment(row, row.receipt, waiter);
      return waiter.promise;
    }
    if (row.producer && !row.file) {
      const waiter = createWaiter(row);
      startAttachmentProducer(row);
      return waiter.promise;
    }
    if (row.size > maxBytes) {
      failRow(row, "validation", tooLarge(row), t("jskit.assistant.attachments.error.uploadFailed"));
      return Promise.resolve(null);
    }
    row.bytesSent = 0;
    row.progress = null;
    row.error = "";
    row.failureStage = "";
    row.phase = "queued";
    const waiter = createWaiter(row);
    uploadQueue.push(row);
    pumpQueue();
    return waiter.promise;
  }

  function detachRow(row) {
    if (["preparing", "queued", "uploading"].includes(row.phase)) {
      cancelAttachment(row);
    }
    row.retained = false;
    rowsById.delete(row.clientId);
    settleWaiter(row, null);
  }

  function removeAttachment(attachment = {}) {
    const row = canonicalRow(attachment);
    if (!row) {
      return [];
    }
    const removedReceipts = removeReadyReceipt(row);
    const removed = removedReceipts.length > 0 ? removedReceipts : [row];
    const receiptToClean = removedReceipts[0] || row.receipt;
    detachRow(row);
    queueItems.value = queueItems.value.filter((candidate) => candidate.clientId !== row.clientId);
    if (receiptToClean) {
      void cleanupReceipt(row.sessionId, receiptToClean);
    }
    return removed;
  }

  function clearAttachments({ accepted = true, attachmentIds = null } = {}) {
    if (!accepted) {
      return abandonAttachments();
    }
    const selectedIds = Array.isArray(attachmentIds) ? new Set(attachmentIds) : null;
    const cleared = attachments.value.filter((attachment) => !selectedIds || selectedIds.has(attachment.attachmentId));
    const readyIds = new Set(cleared.map((attachment) => attachment.clientId));
    const remaining = [];
    for (const row of [...queueItems.value]) {
      if (selectedIds && !readyIds.has(row.clientId)) {
        remaining.push(row);
        continue;
      }
      if (readyIds.has(row.clientId)) {
        row.retained = false;
        rowsById.delete(row.clientId);
        continue;
      }
      detachRow(row);
      if (row.receipt) {
        void cleanupReceipt(row.sessionId, row.receipt);
      }
    }
    attachments.value = attachments.value.filter((attachment) => !readyIds.has(attachment.clientId));
    queueItems.value = remaining;
    return cleared;
  }

  async function abandonAttachments({ onlySessionId = "" } = {}) {
    const normalizedSessionId = String(onlySessionId || "").trim();
    const rows = queueItems.value.filter((row) => (
      !normalizedSessionId || row.sessionId === normalizedSessionId
    ));
    const rowIds = new Set(rows.map((row) => row.clientId));
    const readyReceipts = rows.map((row) => row.receipt).filter(Boolean);
    const attempts = [...activeAttempts.values()].filter((attempt) => rowIds.has(attempt.row.clientId));

    for (const row of rows) {
      detachRow(row);
    }
    queueItems.value = queueItems.value.filter((row) => !rowIds.has(row.clientId));
    attachments.value = attachments.value.filter((attachment) => !rowIds.has(attachment.clientId));

    const readyCleanup = readyReceipts.map((attachment) => cleanupReceipt(
      attachment.sessionId,
      attachment
    ));
    await Promise.allSettled([
      ...readyCleanup,
      ...attempts.map((attempt) => attempt.settled).filter(Boolean)
    ]);
    await waitForAttachmentCleanup();
    return rows;
  }

  async function disposeAttachments() {
    if (disposed) {
      await waitForAttachmentCleanup();
      return [];
    }
    disposed = true;
    stopSessionWatch();
    return abandonAttachments();
  }

  function createQueueRow(options) {
    const row = buildQueueRow(options);
    rowsById.set(row.clientId, row);
    queueItems.value.push(row);
    createWaiter(row);
    return row;
  }

  function queuePreparedFile(row, file, waiter = row.waiter) {
    const preparedFile = assistantAttachmentFiles([file])[0];
    if (!preparedFile) {
      throw Object.assign(new Error("The prepared attachment did not produce a file."), {
        messageCode: "assistant.attachments.error.noFile", messageParams: {}
      });
    }
    row.file = preparedFile;
    row.fileName = attachmentFileName(preparedFile);
    row.size = Number(preparedFile.size) || 0;
    row.totalBytes = row.size;
    if (row.size > maxBytes) {
      failRow(row, "validation", tooLarge(row), t("jskit.assistant.attachments.error.uploadFailed"));
      settleWaiter(row, null, waiter);
      return false;
    }
    row.phase = "queued";
    uploadQueue.push(row);
    pumpQueue();
    return true;
  }

  function startAttachmentProducer(row) {
    const token = Symbol(`${row.clientId}-producer`);
    const waiter = row.waiter;
    const abortController = new AbortController();
    row.file = null;
    row.producerAbortController = abortController;
    row.producerToken = token;
    row.phase = "preparing";
    row.error = "";
    row.failureStage = "";
    row.producerSettled = Promise.resolve().then(() => row.producer({
      signal: abortController.signal
    })).then((file) => {
      if (row.producerToken !== token || !row.retained || disposed) {
        settleWaiter(row, null, waiter);
        return null;
      }
      row.producerAbortController = null;
      row.producerToken = null;
      try {
        queuePreparedFile(row, file, waiter);
      } catch (error) {
        failRow(row, "preparing", error, t("jskit.assistant.attachments.error.preparationFailed"));
        settleWaiter(row, null, waiter);
      }
      return file;
    }, (error) => {
      if (row.producerToken !== token || !row.retained || disposed) {
        settleWaiter(row, null, waiter);
        return null;
      }
      row.producerAbortController = null;
      row.producerToken = null;
      if (error?.name === "AbortError") {
        row.phase = "cancelled";
        row.error = "";
      } else {
        failRow(row, "preparing", error, t("jskit.assistant.attachments.error.preparationFailed"));
      }
      settleWaiter(row, null, waiter);
      return null;
    });
  }

  function uploadFileProducer({
    fileName = t("jskit.assistant.attachments.preparingName"),
    produce
  } = {}) {
    const currentSessionId = assistantAttachmentSessionId(sessionId);
    // readable-check: allow method-probe - input validation: an application hands each call its file producer
    if (!canAddFiles.value || typeof produce !== "function") {
      if (atCapacity.value) {
        reportAttachmentError(tooMany());
      }
      return Promise.resolve(null);
    }
    status.value = "";
    const row = createQueueRow({
      currentSessionId,
      fileName,
      phase: "preparing",
      producer: produce
    });
    const waiter = row.waiter;
    startAttachmentProducer(row);
    return waiter.promise;
  }

  async function uploadFiles(files = []) {
    const uploadableFiles = assistantAttachmentFiles(files);
    const currentSessionId = assistantAttachmentSessionId(sessionId);
    if (
      uploadableFiles.length < 1 ||
      !currentSessionId ||
      disposed ||
      !assistantAttachmentUploadAllowed(canUpload)
    ) {
      return [];
    }

    status.value = "";
    const availableSlots = Math.max(0, maxItems - retainedItemCount.value);
    const acceptedFiles = uploadableFiles.slice(0, availableSlots);
    if (acceptedFiles.length < uploadableFiles.length) {
      reportAttachmentError(tooMany());
    }

    const waiters = [];
    for (const file of acceptedFiles) {
      const row = createQueueRow({ currentSessionId, file });
      const waiter = row.waiter;
      waiters.push(waiter.promise);
      if (row.size > maxBytes) {
        failRow(row, "validation", tooLarge(row), t("jskit.assistant.attachments.error.uploadFailed"));
        settleWaiter(row, null);
      } else {
        uploadQueue.push(row);
      }
    }

    pumpQueue();
    const settled = await Promise.all(waiters);
    return settled.filter((attachment) => (
      attachment && attachments.value.some((candidate) => candidate.clientId === attachment.clientId)
    ));
  }

  const stopSessionWatch = watch(
    () => assistantAttachmentSessionId(sessionId),
    (nextSessionId, previousSessionId) => {
      if (nextSessionId !== previousSessionId && previousSessionId) {
        void abandonAttachments({ onlySessionId: previousSessionId });
      }
    },
    { flush: "sync" }
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      void disposeAttachments();
    });
  }

  return {
    maxBytes,
    maxItems,
    abandonAttachments,
    aggregateProgress,
    attachments,
    atCapacity,
    canAddFiles,
    cancelAttachment,
    canSubmit,
    clearAttachments,
    clearStatus,
    disposeAttachments,
    dragActive,
    hasUnresolved,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    queueItems,
    removeAttachment,
    resetDragState,
    retryAttachment,
    status,
    uploading,
    uploadFiles,
    uploadFileProducer,
    waitForAttachmentCleanup
  };
}

export {
  ASSISTANT_ATTACHMENT_MAX_BYTES,
  ASSISTANT_ATTACHMENT_MAX_ITEMS,
  ASSISTANT_ATTACHMENT_UPLOAD_CONCURRENCY,
  assistantAttachmentEventHasFiles,
  assistantAttachmentFiles,
  assistantAttachmentFilesFromDropEvent,
  assistantAttachmentFilesFromPasteEvent,
  assistantAttachmentFilesFromTransferItems,
  useAssistantAttachments
};
