function createHistoryController({ annuityHistoryService }) {
  async function list(request, reply) {
    const user = request.user;
    const query = request.query || {};
    const pagination = {
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 10)
    };
    const response = await annuityHistoryService.listForUser(user, pagination);
    reply.code(200).send(response);
  }

  return {
    list
  };
}

export { createHistoryController };
