import { AppError } from "../../lib/errors.js";

const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;

function createChatValidationError(fieldErrors = {}) {
  return new AppError(400, "Validation failed.", {
    code: "CHAT_VALIDATION_FAILED",
    details: {
      code: "CHAT_VALIDATION_FAILED",
      fieldErrors
    }
  });
}

async function readOneMultipartAttachment(request, maxUploadBytes) {
  const normalizedMaxUploadBytes = Math.max(1, Number(maxUploadBytes) || CHAT_ATTACHMENT_MAX_UPLOAD_BYTES);
  let filePart;

  try {
    filePart = await request.file({
      limits: {
        files: 1,
        fields: 8,
        fileSize: normalizedMaxUploadBytes
      },
      throwFileSizeLimit: false
    });
  } catch (error) {
    if (String(error?.code || "") === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
      throw createChatValidationError({
        file: "Multipart file upload is required."
      });
    }

    throw error;
  }

  if (!filePart) {
    throw createChatValidationError({
      file: "Uploaded file is required."
    });
  }

  let fileBuffer;
  try {
    fileBuffer = await filePart.toBuffer();
  } catch (error) {
    if (String(error?.code || "") === "FST_REQ_FILE_TOO_LARGE") {
      throw createChatValidationError({
        file: `Uploaded file exceeds maximum size ${normalizedMaxUploadBytes}.`
      });
    }
    throw error;
  }
  if (filePart.file?.truncated || fileBuffer.length > normalizedMaxUploadBytes) {
    throw createChatValidationError({
      file: `Uploaded file exceeds maximum size ${normalizedMaxUploadBytes}.`
    });
  }

  return {
    attachmentId: filePart.fields?.attachmentId?.value,
    fileBuffer,
    uploadFileName: filePart.filename,
    uploadMimeType: filePart.mimetype
  };
}

function createController({ chatService }) {
  if (!chatService) {
    throw new Error("chatService is required.");
  }

  function buildRequestMeta(request) {
    return {
      commandId: request?.headers?.["x-command-id"],
      sourceClientId: request?.headers?.["x-client-id"],
      logger: request?.log || null
    };
  }

  async function ensureDm(request, reply) {
    const result = await chatService.ensureDm({
      user: request.user,
      targetPublicChatId: request.body?.targetPublicChatId
    });

    reply.code(200).send(result);
  }

  async function listInbox(request, reply) {
    const result = await chatService.listInbox({
      user: request.user,
      surfaceId: request.headers?.["x-surface-id"],
      cursor: request.query?.cursor,
      limit: request.query?.limit
    });

    reply.code(200).send(result);
  }

  async function getThread(request, reply) {
    const result = await chatService.getThread({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"]
    });

    reply.code(200).send(result);
  }

  async function listThreadMessages(request, reply) {
    const result = await chatService.listThreadMessages({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      cursor: request.query?.cursor,
      limit: request.query?.limit
    });

    reply.code(200).send(result);
  }

  async function sendThreadMessage(request, reply) {
    const result = await chatService.sendThreadMessage({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {},
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function reserveThreadAttachment(request, reply) {
    const result = await chatService.reserveThreadAttachment({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {},
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function uploadThreadAttachment(request, reply) {
    const maxUploadBytes = Number(request.routeOptions?.bodyLimit || 0) || CHAT_ATTACHMENT_MAX_UPLOAD_BYTES;
    const uploadPayload = await readOneMultipartAttachment(request, maxUploadBytes);
    const result = await chatService.uploadThreadAttachment({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      attachmentId: uploadPayload.attachmentId,
      payload: uploadPayload,
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function deleteThreadAttachment(request, reply) {
    await chatService.deleteThreadAttachment({
      user: request.user,
      threadId: request.params?.threadId,
      attachmentId: request.params?.attachmentId,
      surfaceId: request.headers?.["x-surface-id"],
      requestMeta: buildRequestMeta(request)
    });

    reply.code(204).send();
  }

  async function getAttachmentContent(request, reply) {
    const result = await chatService.getAttachmentContent({
      user: request.user,
      attachmentId: request.params?.attachmentId,
      surfaceId: request.headers?.["x-surface-id"]
    });

    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Authorization, Cookie");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", result.contentDisposition);
    reply.type(result.contentType);
    reply.code(200).send(result.contentBuffer);
  }

  async function markThreadRead(request, reply) {
    const result = await chatService.markThreadRead({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {},
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function addReaction(request, reply) {
    const result = await chatService.addReaction({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {},
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function removeReaction(request, reply) {
    const result = await chatService.removeReaction({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {},
      requestMeta: buildRequestMeta(request)
    });

    reply.code(200).send(result);
  }

  async function emitThreadTyping(request, reply) {
    const result = await chatService.emitThreadTyping({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      requestMeta: buildRequestMeta(request)
    });

    reply.code(202).send(result);
  }

  return {
    ensureDm,
    listInbox,
    getThread,
    listThreadMessages,
    reserveThreadAttachment,
    uploadThreadAttachment,
    deleteThreadAttachment,
    getAttachmentContent,
    sendThreadMessage,
    markThreadRead,
    addReaction,
    removeReaction,
    emitThreadTyping
  };
}

export { createController };
