import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage4 } from "../controllers/ContactControllerStage4.js";
import { ContactQualificationServiceStage4 } from "../services/ContactQualificationServiceStage4.js";
import { InMemoryContactRepositoryStage4 } from "../repositories/InMemoryContactRepositoryStage4.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemasStage4.js";

const STAGE_4_QUALIFICATION_SERVICE = "docs.examples.03.stage4.service.qualification";
const STAGE_4_REPOSITORY = "docs.examples.03.stage4.repository";
const STAGE_4_CONTROLLER = "docs.examples.03.stage4.controller";

class ContactProviderStage4 {
  static id = "docs.examples.03.stage4";

  register(app) {
    app.singleton(STAGE_4_QUALIFICATION_SERVICE, () => new ContactQualificationServiceStage4());
    app.singleton(STAGE_4_REPOSITORY, () => new InMemoryContactRepositoryStage4());

    app.singleton(
      STAGE_4_CONTROLLER,
      () =>
        new ContactControllerStage4({
          qualificationService: app.make(STAGE_4_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_4_REPOSITORY)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_4_CONTROLLER);

    router.register(
      "POST",
      "/api/docs/ch03/stage-4/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/docs/ch03/stage-4/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/docs/ch03/stage-4/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { ContactProviderStage4 };
