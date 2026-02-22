function createController({ chatService }) {
  if (!chatService) {
    throw new Error("chatService is required.");
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
      payload: request.body || {}
    });

    reply.code(200).send(result);
  }

  async function markThreadRead(request, reply) {
    const result = await chatService.markThreadRead({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {}
    });

    reply.code(200).send(result);
  }

  async function addReaction(request, reply) {
    const result = await chatService.addReaction({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {}
    });

    reply.code(200).send(result);
  }

  async function removeReaction(request, reply) {
    const result = await chatService.removeReaction({
      user: request.user,
      threadId: request.params?.threadId,
      surfaceId: request.headers?.["x-surface-id"],
      payload: request.body || {}
    });

    reply.code(200).send(result);
  }

  return {
    ensureDm,
    listInbox,
    getThread,
    listThreadMessages,
    sendThreadMessage,
    markThreadRead,
    addReaction,
    removeReaction
  };
}

export { createController };
