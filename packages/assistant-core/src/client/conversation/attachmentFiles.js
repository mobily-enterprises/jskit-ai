// Which files a drop, a paste or a file list carries, read from the browser's transfer objects, and the drop and
// paste target that hands them to an upload queue.
import { computed, ref } from "vue";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

function assistantAttachmentFiles(fileList = []) {
  return Array.from(fileList || []).filter((file) => file && file.size >= 0);
}

function assistantAttachmentFilesFromTransferItems(items = []) {
  return assistantAttachmentFiles(Array.from(items || [])
    .map((item) => {
      // readable-check: allow method-probe - platform object: a transfer item, or a caller's stand-in for one, may hold no file
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
  // readable-check: allow method-probe - platform object: a paste event, or a caller's stand-in for one, may carry no clipboard text
  if (typeof event?.clipboardData?.getData !== "function") {
    return "";
  }
  return String(event.clipboardData.getData("text/plain") || "");
}

function assistantAttachmentClipboardLocalFileReference(event) {
  const clipboardData = event?.clipboardData;
  // readable-check: allow method-probe - platform object: a paste event, or a caller's stand-in for one, may carry no clipboard text
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

/**
 * A drop zone and paste target that hands the files it receives to `uploadFiles`. Nested drag enters are counted, so
 * the zone stays active until the drag leaves it.
 * @param {{
 *   uploadFiles: (files: File[]) => Promise<any[]>,
 *   reportAttachmentError: (error: unknown) => string
 * }} dependencies
 */
function useAttachmentDropTarget({ uploadFiles, reportAttachmentError }) {
  const dragDepth = ref(0);
  const dragActive = computed(() => dragDepth.value > 0);

  function resetDragState() {
    dragDepth.value = 0;
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

  async function handleDrop(event) {
    resetDragState();
    return uploadFiles(assistantAttachmentFilesFromDropEvent(event));
  }

  async function handlePaste(event) {
    const files = assistantAttachmentFilesFromPasteEvent(event);
    if (files.length < 1) {
      if (assistantAttachmentClipboardLocalFileReference(event)) {
        reportAttachmentError(t("jskit.assistant.attachments.error.localFilePaste"));
      }
      return [];
    }
    if (!assistantAttachmentClipboardText(event)) {
      // readable-check: allow optional-call - platform object: a paste event or a caller's stand-in for one
      event?.preventDefault?.();
    }
    return uploadFiles(files);
  }

  return {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    resetDragState
  };
}

export {
  assistantAttachmentClipboardLocalFileReference,
  assistantAttachmentClipboardText,
  assistantAttachmentEventHasFiles,
  assistantAttachmentFiles,
  assistantAttachmentFilesFromDropEvent,
  assistantAttachmentFilesFromPasteEvent,
  assistantAttachmentFilesFromTransferItems,
  useAttachmentDropTarget
};
