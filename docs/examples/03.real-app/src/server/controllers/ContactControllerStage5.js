class ContactControllerStage5 {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  async intake(request, reply) {
    const result = this.createContactIntakeAction.execute(request.body);
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
    const result = this.previewContactFollowupAction.execute(request.body);
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
      contactId: request.params?.contactId
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

export { ContactControllerStage5 };
