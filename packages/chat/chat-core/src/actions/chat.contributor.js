function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function resolveSurfaceId(context, input) {
  const payload = normalizeObject(input);
  const request = resolveRequest(context);
  return (
    String(payload.surfaceId || request?.headers?.["x-surface-id"] || context?.surface || "app")
      .trim()
      .toLowerCase() || "app"
  );
}

function resolveThreadId(input) {
  const payload = normalizeObject(input);
  return payload.threadId || payload.params?.threadId || null;
}

function resolveAttachmentId(input) {
  const payload = normalizeObject(input);
  return payload.attachmentId || payload.params?.attachmentId || null;
}

function buildRequestMeta(context, input) {
  const payload = normalizeObject(input);
  const request = resolveRequest(context);
  const requestMeta = normalizeObject(payload.requestMeta);

  return {
    commandId: requestMeta.commandId || context?.requestMeta?.commandId || request?.headers?.["x-command-id"] || null,
    sourceClientId: requestMeta.sourceClientId || request?.headers?.["x-client-id"] || null,
    logger: request?.log || null
  };
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createChatActionContributor({ chatService } = {}) {
  const contributorId = "chat.core";

  requireServiceMethod(chatService, "ensureWorkspaceRoom", contributorId);
  requireServiceMethod(chatService, "ensureDm", contributorId);
  requireServiceMethod(chatService, "listDmCandidates", contributorId);
  requireServiceMethod(chatService, "listInbox", contributorId);
  requireServiceMethod(chatService, "listThreadMessages", contributorId);
  requireServiceMethod(chatService, "sendThreadMessage", contributorId);
  requireServiceMethod(chatService, "markThreadRead", contributorId);
  requireServiceMethod(chatService, "emitThreadTyping", contributorId);
  requireServiceMethod(chatService, "reserveThreadAttachment", contributorId);
  requireServiceMethod(chatService, "uploadThreadAttachment", contributorId);
  requireServiceMethod(chatService, "deleteThreadAttachment", contributorId);

  return {
    contributorId,
    domain: "chat",
    actions: Object.freeze([
      {
        id: "chat.workspace_room.ensure",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "chat.workspace_room.ensure"
        },
        observability: {},
        async execute(input, context) {
          return chatService.ensureWorkspaceRoom({
            user: resolveUser(context, input),
            surfaceId: resolveSurfaceId(context, input)
          });
        }
      },
      {
        id: "chat.dm.ensure",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "chat.dm.ensure"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return chatService.ensureDm({
            user: resolveUser(context, payload),
            targetPublicChatId: payload.targetPublicChatId
          });
        }
      },
      {
        id: "chat.dm.candidates.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "chat.dm.candidates.list"
        },
        observability: {},
        async execute(input, context) {
          return chatService.listDmCandidates({
            user: resolveUser(context, input),
            query: normalizeObject(input)
          });
        }
      },
      {
        id: "chat.inbox.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "chat.inbox.list"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return chatService.listInbox({
            user: resolveUser(context, payload),
            surfaceId: resolveSurfaceId(context, payload),
            cursor: payload.cursor,
            limit: payload.limit
          });
        }
      },
      {
        id: "chat.thread.messages.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "chat.thread.messages.list"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return chatService.listThreadMessages({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            cursor: payload.cursor,
            limit: payload.limit
          });
        }
      },
      {
        id: "chat.thread.message.send",
        version: 1,
        kind: "command",
        channels: ["api", "assistant_tool", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "domain_native",
        audit: {
          actionName: "chat.thread.message.send"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const body =
            payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
              ? payload.payload
              : payload;

          return chatService.sendThreadMessage({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            payload: body,
            requestMeta: buildRequestMeta(context, payload)
          });
        }
      },
      {
        id: "chat.thread.read.mark",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "chat.thread.read.mark"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const body =
            payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
              ? payload.payload
              : payload;

          return chatService.markThreadRead({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            payload: body,
            requestMeta: buildRequestMeta(context, payload)
          });
        }
      },
      {
        id: "chat.thread.typing.emit",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "none",
        audit: {
          actionName: "chat.thread.typing.emit"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return chatService.emitThreadTyping({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            requestMeta: buildRequestMeta(context, payload)
          });
        }
      },
      {
        id: "chat.attachment.reserve",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "chat.attachment.reserve"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const body =
            payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
              ? payload.payload
              : payload;

          return chatService.reserveThreadAttachment({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            payload: body,
            requestMeta: buildRequestMeta(context, payload)
          });
        }
      },
      {
        id: "chat.attachment.upload",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "domain_native",
        audit: {
          actionName: "chat.attachment.upload"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const uploadPayload =
            payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
              ? payload.payload
              : payload;

          return chatService.uploadThreadAttachment({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            attachmentId: resolveAttachmentId(payload),
            payload: uploadPayload,
            requestMeta: buildRequestMeta(context, payload)
          });
        }
      },
      {
        id: "chat.attachment.delete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: requireAuthenticated,
        idempotency: "optional",
        audit: {
          actionName: "chat.attachment.delete"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          await chatService.deleteThreadAttachment({
            user: resolveUser(context, payload),
            threadId: resolveThreadId(payload),
            attachmentId: resolveAttachmentId(payload),
            surfaceId: resolveSurfaceId(context, payload),
            requestMeta: buildRequestMeta(context, payload)
          });

          return {
            ok: true
          };
        }
      }
    ])
  };
}

export { createChatActionContributor };
