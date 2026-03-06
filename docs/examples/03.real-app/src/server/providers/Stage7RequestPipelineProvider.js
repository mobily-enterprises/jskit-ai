import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage7 } from "../controllers/ContactControllerStage7.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import {
  contactByIdRouteContractStage7,
  contactIntakeRouteContractStage7,
  contactPreviewFollowupRouteContractStage7
} from "../../shared/schemas/contactSchemas.js";

const STAGE_7_REPOSITORY = "docs.examples.03.stage7.repository";
const STAGE_7_QUALIFICATION_SERVICE = "docs.examples.03.stage7.service.qualification";
const STAGE_7_CREATE_ACTION = "docs.examples.03.stage7.actions.create";
const STAGE_7_PREVIEW_ACTION = "docs.examples.03.stage7.actions.preview";
const STAGE_7_GET_BY_ID_ACTION = "docs.examples.03.stage7.actions.getById";
const STAGE_7_CONTROLLER = "docs.examples.03.stage7.controller";

class Stage7RequestPipelineProvider {
  static id = "docs.examples.03.stage7";

  register(app) {
    app.singleton(STAGE_7_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_7_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_7_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
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
      contactIntakeRouteContractStage7,
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
      contactPreviewFollowupRouteContractStage7,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-7/contacts/:contactId",
      contactByIdRouteContractStage7,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage7RequestPipelineProvider };
