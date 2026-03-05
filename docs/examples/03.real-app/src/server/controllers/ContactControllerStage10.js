import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage10 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, contactsConfig }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.contactsConfig = contactsConfig;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  attachConfigHeaders(reply) {
    reply.header("x-contacts-mode", this.contactsConfig.mode);
    reply.header(
      "x-contacts-max-starter-employees",
      String(this.contactsConfig.maxStarterEmployees)
    );
  }

  async intake(request, reply) {
    const payload = this.resolveInputBody(request);
    const created = await this.createContactIntakeAction.execute(payload);
    this.attachConfigHeaders(reply);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = this.resolveInputBody(request);
    const preview = await this.previewContactFollowupAction.execute(payload);
    this.attachConfigHeaders(reply);
    return this.ok(reply, preview);
  }
}

export { ContactControllerStage10 };
