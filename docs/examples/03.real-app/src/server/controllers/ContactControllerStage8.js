import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage8 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  async intake(request, reply) {
    const payload = request.input.body;
    const created = await this.createContactIntakeAction.execute(payload);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = request.input.body;
    const preview = await this.previewContactFollowupAction.execute(payload);
    return this.ok(reply, preview);
  }

  async show(request, reply) {
    const contact = await this.getContactByIdAction.execute({
      contactId: request.input.params.contactId
    });
    return this.ok(reply, contact);
  }
}

export { ContactControllerStage8 };
