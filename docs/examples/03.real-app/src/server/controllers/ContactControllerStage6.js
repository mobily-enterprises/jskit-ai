import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage6 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
  }

  async intake(request, reply) {
    const payload = request.input?.body ?? request.body;
    const result = this.createContactIntakeAction.execute(payload);
    return this.sendActionResult(reply, result, {
      defaultErrorMessage: "Domain validation failed."
    });
  }

  async previewFollowup(request, reply) {
    const payload = request.input?.body ?? request.body;
    const result = this.previewContactFollowupAction.execute(payload);
    return this.sendActionResult(reply, result, {
      defaultErrorMessage: "Domain validation failed."
    });
  }
}

export { ContactControllerStage6 };
