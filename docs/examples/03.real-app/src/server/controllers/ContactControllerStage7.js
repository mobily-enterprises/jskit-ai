class ContactControllerStage7 {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  async intake(request, reply) {
    const payload = request.input.body;
    const query = request.input.query;

    const result = query.dryRun
      ? this.previewContactFollowupAction.execute(payload)
      : this.createContactIntakeAction.execute(payload);

    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async previewFollowup(request, reply) {
    const payload = request.input.body;
    const result = this.previewContactFollowupAction.execute(payload);

    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async show(request, reply) {
    const result = this.getContactByIdAction.execute({
      contactId: request.input?.params?.contactId || request.params?.contactId
    });
    if (!result.ok) {
      reply.code(result.status).send({
        error: "Contact not found.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }
}

export { ContactControllerStage7 };
