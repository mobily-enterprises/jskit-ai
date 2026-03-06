import { BaseController } from "@jskit-ai/kernel/server/http";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { STAGE_9_REQUEST_CONTEXT_TOKEN } from "../support/contactsMiddlewareStage9.js";

class ContactControllerStage9 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  attachRequestScopeHeaders(request, reply) {
    const scope = request?.scope;
    if (!scope || typeof scope.make !== "function") {
      return;
    }

    const requestId = scope.make(KERNEL_TOKENS.RequestId);
    if (requestId) {
      reply.header("x-request-id", requestId);
    }

    const context = scope.has(STAGE_9_REQUEST_CONTEXT_TOKEN)
      ? scope.make(STAGE_9_REQUEST_CONTEXT_TOKEN)
      : null;

    if (context?.receivedAt) {
      reply.header("x-request-received-at", context.receivedAt);
    }
  }

  async intake(request, reply) {
    const payload = this.resolveInputBody(request);
    const created = await this.createContactIntakeAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = this.resolveInputBody(request);
    const preview = await this.previewContactFollowupAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, preview);
  }

  async show(request, reply) {
    const contact = await this.getContactByIdAction.execute({
      contactId: request.input?.params?.contactId || request.params?.contactId
    });
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, contact);
  }
}

export { ContactControllerStage9 };
