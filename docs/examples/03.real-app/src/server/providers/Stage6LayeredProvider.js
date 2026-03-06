import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage6 } from "../controllers/ContactControllerStage6.js";
import { ContactQualificationService } from "../services/ContactQualificationServiceStage6.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepositoryStage6.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeActionStage6.js";
import { GetContactByIdAction } from "../actions/GetContactByIdActionStage6.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupActionStage6.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemasStage6.js";

const STAGE_6_REPOSITORY = "docs.examples.03.stage6.repository";
const STAGE_6_QUALIFICATION_SERVICE = "docs.examples.03.stage6.service.qualification";
const STAGE_6_CREATE_ACTION = "docs.examples.03.stage6.actions.create";
const STAGE_6_PREVIEW_ACTION = "docs.examples.03.stage6.actions.preview";
const STAGE_6_GET_BY_ID_ACTION = "docs.examples.03.stage6.actions.getById";
const STAGE_6_CONTROLLER = "docs.examples.03.stage6.controller";

class Stage6LayeredProvider {
  static id = "docs.examples.03.stage6";

  register(app) {
    app.singleton(STAGE_6_REPOSITORY, () => new InMemoryContactRepository());

    app.singleton(
      STAGE_6_QUALIFICATION_SERVICE,
      () => new ContactQualificationService()
    );

    app.singleton(
      STAGE_6_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
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
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_6_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-6/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage6LayeredProvider };
