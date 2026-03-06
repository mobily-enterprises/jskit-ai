import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactController } from "../controllers/ContactController.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const CONTACT_REPOSITORY = "local.main.contacts.repository";
const CONTACT_QUALIFICATION_SERVICE = "local.main.contacts.service.qualification";
const CONTACT_CREATE_ACTION = "local.main.contacts.actions.create";
const CONTACT_PREVIEW_ACTION = "local.main.contacts.actions.preview";
const CONTACT_GET_BY_ID_ACTION = "local.main.contacts.actions.getById";
const CONTACT_CONTROLLER = "local.main.contacts.controller";

class MainServiceProvider {
  static id = "local.main";

  register(app) {
    app.singleton(CONTACT_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(CONTACT_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      CONTACT_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(CONTACT_QUALIFICATION_SERVICE),
          contactRepository: app.make(CONTACT_REPOSITORY)
        })
    );

    app.singleton(
      CONTACT_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(CONTACT_QUALIFICATION_SERVICE),
          contactRepository: app.make(CONTACT_REPOSITORY)
        })
    );

    app.singleton(
      CONTACT_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
          contactRepository: app.make(CONTACT_REPOSITORY)
        })
    );

    app.singleton(
      CONTACT_CONTROLLER,
      () =>
        new ContactController({
          createContactIntakeAction: app.make(CONTACT_CREATE_ACTION),
          previewContactFollowupAction: app.make(CONTACT_PREVIEW_ACTION),
          getContactByIdAction: app.make(CONTACT_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(CONTACT_CONTROLLER);

    router.register("POST", "/api/v1/contacts/intake", contactIntakePostRouteContract, (request, reply) =>
      controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/contacts/preview-followup",
      contactPreviewFollowupPostRouteContract,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register("GET", "/api/v1/contacts/:contactId", contactByIdGetRouteContract, (request, reply) =>
      controller.show(request, reply)
    );
  }
}

export { MainServiceProvider };
