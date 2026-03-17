import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage3 } from "../controllers/ContactControllerStage3.js";
import { ContactQualificationServiceStage3 } from "../services/ContactQualificationServiceStage3.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemasStage3.js";

const STAGE_3_QUALIFICATION_SERVICE = "docs.examples.03.stage3.service.qualification";
const STAGE_3_CONTROLLER = "docs.examples.03.stage3.controller";

class ContactProviderStage3 {
  static id = "docs.examples.03.stage3";

  register(app) {
    app.singleton(STAGE_3_QUALIFICATION_SERVICE, () => new ContactQualificationServiceStage3());

    app.singleton(
      STAGE_3_CONTROLLER,
      () =>
        new ContactControllerStage3({
          qualificationService: app.make(STAGE_3_QUALIFICATION_SERVICE)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_3_CONTROLLER);

    router.register(
      "POST",
      "/api/docs/ch03/stage-3/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/docs/ch03/stage-3/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/docs/ch03/stage-3/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { ContactProviderStage3 };
