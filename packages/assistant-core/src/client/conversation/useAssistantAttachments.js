import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
  toValue,
  watch
} from "vue";

function assistantAttachmentSessionId(sessionId) {
  return String(toValue(sessionId) || "").trim();
}

function assistantAttachmentUploadAllowed(canUpload) {
  return toValue(canUpload) !== false;
}

function assistantAttachmentFiles(fileList = []) {
  return Array.from(fileList || []).filter((file) => file && file.size >= 0);
}

function assistantAttachmentFilesFromTransferItems(items = []) {
  return assistantAttachmentFiles(Array.from(items || [])
    .map((item) => {
      if (item?.kind !== "file" || typeof item.getAsFile !== "function") {
        return null;
      }
      return item.getAsFile();
    }));
}

function assistantAttachmentFilesFromDropEvent(event) {
  const dataTransfer = event?.dataTransfer;
  const itemFiles = assistantAttachmentFilesFromTransferItems(dataTransfer?.items);
  if (itemFiles.length > 0) {
    return itemFiles;
  }
  return assistantAttachmentFiles(dataTransfer?.files);
}

function assistantAttachmentFilesFromPasteEvent(event) {
  const clipboardData = event?.clipboardData;
  const itemFiles = assistantAttachmentFilesFromTransferItems(clipboardData?.items);
  if (itemFiles.length > 0) {
    return itemFiles;
  }
  return assistantAttachmentFiles(clipboardData?.files);
}

function assistantAttachmentEventHasFiles(event) {
  const dataTransfer = event?.dataTransfer;
  return assistantAttachmentFilesFromDropEvent(event).length > 0 ||
    Array.from(dataTransfer?.items || []).some((item) => item?.kind === "file") ||
    Array.from(dataTransfer?.types || []).some((type) => (
      type === "Files" ||
      type === "application/x-moz-file"
    ));
}

function assistantAttachmentClipboardText(event) {
  if (typeof event?.clipboardData?.getData !== "function") {
    return "";
  }
  return String(event.clipboardData.getData("text/plain") || "");
}

function assistantAttachmentClipboardLocalFileReference(event) {
  const clipboardData = event?.clipboardData;
  if (!clipboardData || typeof clipboardData.getData !== "function") {
    return "";
  }
  const types = Array.from(clipboardData.types || []);
  const text = [
    clipboardData.getData("x-special/gnome-copied-files"),
    clipboardData.getData("text/uri-list"),
    clipboardData.getData("text/plain")
  ].map((value) => String(value || "").trim()).filter(Boolean).join("\n");
  if (
    types.includes("Files") ||
    types.includes("application/x-moz-file") ||
    types.includes("x-special/gnome-copied-files") ||
    /^file:/imu.test(text)
  ) {
    return text || "file://";
  }
  return "";
}

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

const ASSISTANT_ATTACHMENT_MAX_BYTES = 100_000_000;
const ASSISTANT_ATTACHMENT_MAX_ITEMS = 10;
const ASSISTANT_ATTACHMENT_UPLOAD_CONCURRENCY = 2;
const ASSISTANT_ATTACHMENT_UNRESOLVED_PHASES = new Set([
  "preparing",
  "queued",
  "uploading",
  "delivering",
  "failed"
]);

let attachmentClientSequence = 0;

function nextAttachmentClientId() {
  attachmentClientSequence += 1;
  return `attachment-${Date.now().toString(36)}-${attachmentClientSequence.toString(36)}`;
}

function attachmentFileName(file = {}) {
  return String(file?.name || "attachment");
}

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

function useAssistantAttachments({
  canUpload = () => true,
  deleteAttachment = null,
  onError = null,
  onUploaded = async () => null,
  sessionId,
  uploadAttachment,
  maxBytes = ASSISTANT_ATTACHMENT_MAX_BYTES,
  maxItems = ASSISTANT_ATTACHMENT_MAX_ITEMS,
  uploadConcurrency = ASSISTANT_ATTACHMENT_UPLOAD_CONCURRENCY
} = {}) {
  if (![maxBytes, maxItems, uploadConcurrency].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("Attachment limits must be positive integers.");
  }
  const attachments = ref([]);
  const queueItems = ref([]);
  const dragDepth = ref(0);
  const status = ref("");
  const activeUploadCount = ref(0);
  const uploadQueue = [];
  const rowsById = new Map();
  const activeAttempts = new Map();
  const cleanupTasks = new Set();
  const receiptCleanupById = new Map();
  const cleanedReceiptIds = new Set();
  let disposed = false;
  let stopSessionWatch = null;

  const dragActive = computed(() => dragDepth.value > 0);
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
    !atCapacity.value &&
    typeof uploadAttachment === "function"
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

  function reportAttachmentError(error, fallbackMessage = "Attachment upload failed.", {
    notify = true
  } = {}) {
    const message = String(error?.message || error || fallbackMessage);
    status.value = message;
    if (notify && typeof onError === "function") {
      try {
        onError(error || new Error(message), fallbackMessage);
      } catch {
        // Feedback presentation must not replace the recoverable attachment state.
      }
    }
    return message;
  }

  function resetDragState() {
    dragDepth.value = 0;
  }

  function clearStatus() {
    status.value = "";
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

  function canonicalRow(attachment = {}) {
    const identity = attachmentIdentity(attachment);
    return identity ? rowsById.get(identity) || queueItems.value.find((row) => (
      attachmentIdentity(row) === identity || row.attachmentId === identity
    )) : null;
  }

  function trackCleanup(task) {
    const cleanup = Promise.resolve(task).catch((error) => {
      reportAttachmentError(error, "Attachment cleanup failed.");
      return false;
    });
    cleanupTasks.add(cleanup);
    cleanup.finally(() => cleanupTasks.delete(cleanup));
    return cleanup;
  }

  async function deleteUploadedAttachment(currentSessionId, attachment = {}) {
    const attachmentId = String(attachment?.attachmentId || "").trim();
    if (!attachmentId || typeof deleteAttachment !== "function") {
      return false;
    }
    const response = await deleteAttachment(currentSessionId, attachmentId);
    if (response?.ok === false) {
      throw new Error(attachmentUploadError(response) || "Attachment cleanup failed.");
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

  function updateProgress(row, progress, total) {
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
      row.error = String(error?.message || error || "Uploaded attachment could not be used.");
      row.failureStage = "handoff";
      row.phase = "failed";
      settleWaiter(row, null, waiter);
      reportAttachmentError(error, "Uploaded attachment could not be used.", { notify: false });
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
        attachmentUploadError(uploaded) || "Attachment upload failed."
      );
      row.error = String(error?.message || error || "Attachment upload failed.");
      row.failureStage = "upload";
      row.phase = "failed";
      settleWaiter(row, null, attempt.waiter);
      reportAttachmentError(error, "Attachment upload failed.", { notify: false });
    }
    pumpQueue();
  }

  function startUpload(row) {
    const token = Symbol(row.clientId);
    const abortController = typeof AbortController === "function"
      ? new AbortController()
      : null;
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
        onProgress: (progress, total) => updateProgress(row, progress, total),
        signal: abortController?.signal
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
      attempt?.abortController?.abort();
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
      !assistantAttachmentUploadAllowed(canUpload) ||
      typeof uploadAttachment !== "function"
    ) {
      return Promise.resolve(null);
    }
    if (row.phase === "cancelled" && retainedItemCount.value >= maxItems) {
      reportAttachmentError(`A message can keep at most ${maxItems} attachments.`);
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
      row.error = `${row.fileName} is larger than the ${maxBytes / 1_000_000} MB attachment limit.`;
      row.failureStage = "validation";
      row.phase = "failed";
      reportAttachmentError(row.error, "Attachment upload failed.", { notify: false });
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

  async function waitForAttachmentCleanup() {
    while (cleanupTasks.size > 0) {
      await Promise.allSettled([...cleanupTasks]);
    }
  }

  async function disposeAttachments() {
    if (disposed) {
      await waitForAttachmentCleanup();
      return [];
    }
    disposed = true;
    stopSessionWatch?.();
    stopSessionWatch = null;
    return abandonAttachments();
  }

  function handleDragEnter(event) {
    if (!assistantAttachmentEventHasFiles(event)) {
      return;
    }
    dragDepth.value += 1;
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragOver(event) {
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave() {
    dragDepth.value = Math.max(0, dragDepth.value - 1);
  }

  function createQueueRow({
    currentSessionId,
    file = null,
    fileName = "attachment",
    phase = "queued",
    producer = null,
    size = 0
  } = {}) {
    const normalizedSize = Number(file?.size ?? size) || 0;
    const row = reactive({
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
    rowsById.set(row.clientId, row);
    queueItems.value.push(row);
    createWaiter(row);
    return row;
  }

  function queuePreparedFile(row, file, waiter = row.waiter) {
    const preparedFile = assistantAttachmentFiles([file])[0];
    if (!preparedFile) {
      throw new Error("The prepared attachment did not produce a file.");
    }
    row.file = preparedFile;
    row.fileName = attachmentFileName(preparedFile);
    row.size = Number(preparedFile.size) || 0;
    row.totalBytes = row.size;
    if (row.size > maxBytes) {
      row.error = `${row.fileName} is larger than the ${maxBytes / 1_000_000} MB attachment limit.`;
      row.failureStage = "validation";
      row.phase = "failed";
      settleWaiter(row, null, waiter);
      reportAttachmentError(row.error, "Attachment upload failed.", { notify: false });
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
    const abortController = typeof AbortController === "function"
      ? new AbortController()
      : null;
    row.file = null;
    row.producerAbortController = abortController;
    row.producerToken = token;
    row.phase = "preparing";
    row.error = "";
    row.failureStage = "";
    row.producerSettled = Promise.resolve().then(() => row.producer({
      signal: abortController?.signal
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
        row.error = String(error?.message || error || "Attachment preparation failed.");
        row.failureStage = "preparing";
        row.phase = "failed";
        settleWaiter(row, null, waiter);
        reportAttachmentError(error, "Attachment preparation failed.", { notify: false });
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
        row.error = String(error?.message || error || "Attachment preparation failed.");
        row.failureStage = "preparing";
        row.phase = "failed";
        reportAttachmentError(error, "Attachment preparation failed.", { notify: false });
      }
      settleWaiter(row, null, waiter);
      return null;
    });
  }

  function uploadFileProducer({
    fileName = "Preparing attachment…",
    produce
  } = {}) {
    const currentSessionId = assistantAttachmentSessionId(sessionId);
    if (!canAddFiles.value || typeof produce !== "function") {
      if (atCapacity.value) {
        reportAttachmentError(`A message can keep at most ${maxItems} attachments.`);
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
      !assistantAttachmentUploadAllowed(canUpload) ||
      typeof uploadAttachment !== "function"
    ) {
      return [];
    }

    status.value = "";
    const availableSlots = Math.max(0, maxItems - retainedItemCount.value);
    const acceptedFiles = uploadableFiles.slice(0, availableSlots);
    if (acceptedFiles.length < uploadableFiles.length) {
      reportAttachmentError(`A message can keep at most ${maxItems} attachments.`);
    }

    const waiters = [];
    for (const file of acceptedFiles) {
      const row = createQueueRow({ currentSessionId, file });
      const waiter = row.waiter;
      waiters.push(waiter.promise);
      if (row.size > maxBytes) {
        row.error = `${row.fileName} is larger than the ${maxBytes / 1_000_000} MB attachment limit.`;
        row.failureStage = "validation";
        row.phase = "failed";
        settleWaiter(row, null);
        reportAttachmentError(row.error, "Attachment upload failed.", { notify: false });
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

  async function handleDrop(event) {
    resetDragState();
    return uploadFiles(assistantAttachmentFilesFromDropEvent(event));
  }

  async function handlePaste(event) {
    const files = assistantAttachmentFilesFromPasteEvent(event);
    if (files.length < 1) {
      if (assistantAttachmentClipboardLocalFileReference(event)) {
        reportAttachmentError(
          "Copied local files cannot be pasted from this browser. Drop the file or use Attach files."
        );
      }
      return [];
    }
    if (!assistantAttachmentClipboardText(event)) {
      event?.preventDefault?.();
    }
    return uploadFiles(files);
  }

  stopSessionWatch = watch(
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
