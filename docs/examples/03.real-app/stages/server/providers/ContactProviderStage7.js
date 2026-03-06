import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage7 } from "../controllers/ContactControllerStage7.js";
import { ContactQualificationServiceStage7 } from "../services/ContactQualificationServiceStage7.js";
import { InMemoryContactRepositoryStage7 } from "../repositories/InMemoryContactRepositoryStage7.js";
import { CreateContactIntakeActionStage7 } from "../actions/CreateContactIntakeActionStage7.js";
import { GetContactByIdActionStage7 } from "../actions/GetContactByIdActionStage7.js";
import { PreviewContactFollowupActionStage7 } from "../actions/PreviewContactFollowupActionStage7.js";
import {
  contactByIdGetRouteContractStage7,
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7
} from "../../shared/schemas/contactSchemasStage7.js";

const STAGE_7_REPOSITORY = "docs.examples.03.stage7.repository";
const STAGE_7_QUALIFICATION_SERVICE = "docs.examples.03.stage7.service.qualification";
const STAGE_7_CREATE_ACTION = "docs.examples.03.stage7.actions.create";
const STAGE_7_PREVIEW_ACTION = "docs.examples.03.stage7.actions.preview";
const STAGE_7_GET_BY_ID_ACTION = "docs.examples.03.stage7.actions.getById";
const STAGE_7_CONTROLLER = "docs.examples.03.stage7.controller";

class ContactProviderStage7 {
  static id = "docs.examples.03.stage7";

  register(app) {
    app.singleton(STAGE_7_REPOSITORY, () => new InMemoryContactRepositoryStage7());
    app.singleton(STAGE_7_QUALIFICATION_SERVICE, () => new ContactQualificationServiceStage7());

    app.singleton(
      STAGE_7_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage7({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage7({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage7({
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_CONTROLLER,
      () =>
        new ContactControllerStage7({
          createContactIntakeAction: app.make(STAGE_7_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_7_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_7_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_7_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/intake",
      contactIntakePostRouteContractStage7,
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
      contactPreviewFollowupPostRouteContractStage7,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-7/contacts/:contactId",
      contactByIdGetRouteContractStage7,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { ContactProviderStage7 };
