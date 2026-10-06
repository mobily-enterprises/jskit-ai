export function attachmentSizeLabel(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function conversationAttachmentManifest(attachments = []) {
  const references = attachments.map((attachment) => `${attachment.reference} ${JSON.stringify(attachment.fileName)}: ${JSON.stringify(attachment.path)}`);
  return attachments.length ? `\n\nAttached files:\n${references.join("\n")}` : "";
}

/** The application supplies authorized files and its visible receipt projection. */
export function prepareConversationAttachmentMessage(input, attachments, displayAttachments) {
  const message = String(input.message ?? input.prompt ?? "");
  return {
    ...input,
    attachments,
    displayAttachments,
    ...(attachments.length ? {
      displayMessage: input.displayMessage ?? message,
      message: `${message}${conversationAttachmentManifest(attachments)}`
    } : {})
  };
}
