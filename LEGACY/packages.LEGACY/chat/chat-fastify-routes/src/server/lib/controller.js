const CHAT_ACTION_IDS = Object.freeze({
  WORKSPACE_ROOM_ENSURE: "chat.workspace_room.ensure",
  DM_ENSURE: "chat.dm.ensure",
  DM_CANDIDATES_LIST: "chat.dm.candidates.list",
  INBOX_LIST: "chat.inbox.list",
  THREAD_GET: "chat.thread.get",
  THREAD_MESSAGES_LIST: "chat.thread.messages.list",
  THREAD_MESSAGE_SEND: "chat.thread.message.send",
  ATTACHMENT_RESERVE: "chat.attachment.reserve",
  ATTACHMENT_UPLOAD: "chat.attachment.upload",
  ATTACHMENT_DELETE: "chat.attachment.delete",
  ATTACHMENT_CONTENT_GET: "chat.attachment.content.get",
  THREAD_READ_MARK: "chat.thread.read.mark",
  THREAD_REACTION_ADD: "chat.thread.reaction.add",
  THREAD_REACTION_REMOVE: "chat.thread.reaction.remove",
  THREAD_TYPING_EMIT: "chat.thread.typing.emit"
});

const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

function createChatValidationError(AppErrorClass, fieldErrors = {}) {
  return new AppErrorClass(400, "Validation failed.", {
    code: "CHAT_VALIDATION_FAILED",
    details: {
      code: "CHAT_VALIDATION_FAILED",
      fieldErrors
    }
  });
}

async function readOneMultipartAttachment(request, maxUploadBytes, AppErrorClass = DefaultAppError) {
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
      throw createChatValidationError(AppErrorClass, {
        file: "Multipart file upload is required."
      });
    }

    throw error;
  }

  if (!filePart) {
    throw createChatValidationError(AppErrorClass, {
      file: "Uploaded file is required."
    });
  }

  let fileBuffer;
  try {
    fileBuffer = await filePart.toBuffer();
  } catch (error) {
    if (String(error?.code || "") === "FST_REQ_FILE_TOO_LARGE") {
      throw createChatValidationError(AppErrorClass, {
        file: `Uploaded file exceeds maximum size ${normalizedMaxUploadBytes}.`
      });
    }
    throw error;
  }
  if (filePart.file?.truncated || fileBuffer.length > normalizedMaxUploadBytes) {
    throw createChatValidationError(AppErrorClass, {
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

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function createController({ actionExecutor, appErrorClass = null }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }
  const AppErrorClass = typeof appErrorClass === "function" ? appErrorClass : DefaultAppError;

  async function ensureDm(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.DM_ENSURE,
      request,
      input: {
        targetPublicChatId: request.body?.targetPublicChatId
      }
    });

    reply.code(200).send(result);
  }

  async function ensureWorkspaceRoom(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.WORKSPACE_ROOM_ENSURE,
      request
    });

    reply.code(200).send(result);
  }

  async function listDmCandidates(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.DM_CANDIDATES_LIST,
      request,
      input: request.query || {}
    });

    reply.code(200).send(result);
  }

  async function listInbox(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.INBOX_LIST,
      request,
      input: {
        cursor: request.query?.cursor,
        limit: request.query?.limit
      }
    });

    reply.code(200).send(result);
  }

  async function getThread(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_GET,
      request,
      input: {
        threadId: request.params?.threadId
      }
    });

    reply.code(200).send(result);
  }

  async function listThreadMessages(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_MESSAGES_LIST,
      request,
      input: {
        threadId: request.params?.threadId,
        cursor: request.query?.cursor,
        limit: request.query?.limit
      }
    });

    reply.code(200).send(result);
  }

  async function sendThreadMessage(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_MESSAGE_SEND,
      request,
      input: {
        threadId: request.params?.threadId,
        payload: request.body || {}
      }
    });

    reply.code(200).send(result);
  }

  async function reserveThreadAttachment(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.ATTACHMENT_RESERVE,
      request,
      input: {
        threadId: request.params?.threadId,
        payload: request.body || {}
      }
    });

    reply.code(200).send(result);
  }

  async function uploadThreadAttachment(request, reply) {
    const maxUploadBytes = Number(request.routeOptions?.bodyLimit || 0) || CHAT_ATTACHMENT_MAX_UPLOAD_BYTES;
    const uploadPayload = await readOneMultipartAttachment(request, maxUploadBytes, AppErrorClass);
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.ATTACHMENT_UPLOAD,
      request,
      input: {
        threadId: request.params?.threadId,
        attachmentId: uploadPayload.attachmentId,
        payload: uploadPayload
      }
    });

    reply.code(200).send(result);
  }

  async function deleteThreadAttachment(request, reply) {
    await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.ATTACHMENT_DELETE,
      request,
      input: {
        threadId: request.params?.threadId,
        attachmentId: request.params?.attachmentId
      }
    });

    reply.code(204).send();
  }

  async function getAttachmentContent(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.ATTACHMENT_CONTENT_GET,
      request,
      input: {
        attachmentId: request.params?.attachmentId
      }
    });

    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Authorization, Cookie");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", result.contentDisposition);
    reply.type(result.contentType);
    reply.code(200).send(result.contentBuffer);
  }

  async function markThreadRead(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_READ_MARK,
      request,
      input: {
        threadId: request.params?.threadId,
        payload: request.body || {}
      }
    });

    reply.code(200).send(result);
  }

  async function addReaction(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_REACTION_ADD,
      request,
      input: {
        threadId: request.params?.threadId,
        payload: request.body || {}
      }
    });

    reply.code(200).send(result);
  }

  async function removeReaction(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_REACTION_REMOVE,
      request,
      input: {
        threadId: request.params?.threadId,
        payload: request.body || {}
      }
    });

    reply.code(200).send(result);
  }

  async function emitThreadTyping(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: CHAT_ACTION_IDS.THREAD_TYPING_EMIT,
      request,
      input: {
        threadId: request.params?.threadId
      }
    });

    reply.code(202).send(result);
  }

  return {
    ensureWorkspaceRoom,
    ensureDm,
    listDmCandidates,
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

const __testables = {
  DefaultAppError,
  createChatValidationError,
  readOneMultipartAttachment
};

export { createController, __testables };
