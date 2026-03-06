import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage5 } from "../controllers/ContactControllerStage5.js";
import { ContactQualificationServiceStage5 } from "../services/ContactQualificationServiceStage5.js";
import { InMemoryContactRepositoryStage5 } from "../repositories/InMemoryContactRepositoryStage5.js";
import { CreateContactIntakeActionStage5 } from "../actions/CreateContactIntakeActionStage5.js";
import { GetContactByIdActionStage5 } from "../actions/GetContactByIdActionStage5.js";
import { PreviewContactFollowupActionStage5 } from "../actions/PreviewContactFollowupActionStage5.js";
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

class ContactProviderStage5 {
  static id = "docs.examples.03.stage5";

  register(app) {
    app.singleton(STAGE_5_REPOSITORY, () => new InMemoryContactRepositoryStage5());
    app.singleton(STAGE_5_QUALIFICATION_SERVICE, () => new ContactQualificationServiceStage5());

    app.singleton(
      STAGE_5_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage5({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage5({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage5({
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

export { ContactProviderStage5 };
