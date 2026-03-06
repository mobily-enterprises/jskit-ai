import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage5 } from "../controllers/ContactControllerStage5.js";
import { ContactQualificationService } from "../services/ContactQualificationServiceStage5.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepositoryStage5.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeActionStage5.js";
import { GetContactByIdAction } from "../actions/GetContactByIdActionStage5.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupActionStage5.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemasStage5.js";

const STAGE_5_REPOSITORY = "docs.examples.03.stage5.repository";
const STAGE_5_QUALIFICATION_SERVICE = "docs.examples.03.stage5.service.qualification";
const STAGE_5_CREATE_ACTION = "docs.examples.03.stage5.actions.create";
const STAGE_5_PREVIEW_ACTION = "docs.examples.03.stage5.actions.preview";
const STAGE_5_GET_BY_ID_ACTION = "docs.examples.03.stage5.actions.getById";
const STAGE_5_CONTROLLER = "docs.examples.03.stage5.controller";

class Stage5ActionProvider {
  static id = "docs.examples.03.stage5";

  register(app) {
    app.singleton(STAGE_5_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_5_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_5_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_CONTROLLER,
      () =>
        new ContactControllerStage5({
          createContactIntakeAction: app.make(STAGE_5_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_5_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_5_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_5_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-5/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage5ActionProvider };
