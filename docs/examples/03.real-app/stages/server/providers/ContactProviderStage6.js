import { ContactControllerStage6 } from "../controllers/ContactControllerStage6.js";
import { ContactQualificationServiceStage6 } from "../services/ContactQualificationServiceStage6.js";
import { InMemoryContactRepositoryStage6 } from "../repositories/InMemoryContactRepositoryStage6.js";
import { CreateContactIntakeActionStage6 } from "../actions/CreateContactIntakeActionStage6.js";
import { GetContactByIdActionStage6 } from "../actions/GetContactByIdActionStage6.js";
import { PreviewContactFollowupActionStage6 } from "../actions/PreviewContactFollowupActionStage6.js";
import {
  contactByIdGetRouteContractStage6,
  contactIntakePostRouteContractStage6,
  contactPreviewFollowupPostRouteContractStage6
} from "../../shared/schemas/contactSchemasStage6.js";

const STAGE_6_REPOSITORY = "docs.examples.03.stage6.repository";
const STAGE_6_QUALIFICATION_SERVICE = "docs.examples.03.stage6.service.qualification";
const STAGE_6_CREATE_ACTION = "docs.examples.03.stage6.actions.create";
const STAGE_6_PREVIEW_ACTION = "docs.examples.03.stage6.actions.preview";
const STAGE_6_GET_BY_ID_ACTION = "docs.examples.03.stage6.actions.getById";
const STAGE_6_CONTROLLER = "docs.examples.03.stage6.controller";

class ContactProviderStage6 {
  static id = "docs.examples.03.stage6";

  register(app) {
    app.singleton(STAGE_6_REPOSITORY, () => new InMemoryContactRepositoryStage6());
    app.singleton(
      STAGE_6_QUALIFICATION_SERVICE,
      () => new ContactQualificationServiceStage6()
    );

    app.singleton(
      STAGE_6_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage6({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage6({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage6({
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_CONTROLLER,
      () =>
        new ContactControllerStage6({
          createContactIntakeAction: app.make(STAGE_6_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_6_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_6_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make("jskit.http.router");
    const controller = app.make(STAGE_6_CONTROLLER);

    router.register(
      "POST",
      "/api/docs/ch03/stage-6/contacts/intake",
      contactIntakePostRouteContractStage6,
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/docs/ch03/stage-6/contacts/preview-followup",
      contactPreviewFollowupPostRouteContractStage6,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/docs/ch03/stage-6/contacts/:contactId",
      contactByIdGetRouteContractStage6,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { ContactProviderStage6 };
