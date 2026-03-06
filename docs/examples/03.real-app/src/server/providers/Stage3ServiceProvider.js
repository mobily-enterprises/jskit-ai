import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage3 } from "../controllers/ContactControllerStage3.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import {
  contactByIdRouteContract,
  contactIntakePreviewRouteSchema
} from "../../shared/schemas/contactSchemas.js";

const STAGE_3_QUALIFICATION_SERVICE = "docs.examples.03.stage3.service.qualification";
const STAGE_3_CONTROLLER = "docs.examples.03.stage3.controller";

class Stage3ServiceProvider {
  static id = "docs.examples.03.stage3";

  register(app) {
    app.singleton(STAGE_3_QUALIFICATION_SERVICE, () => new ContactQualificationService());

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
      "/api/v1/docs/ch03/stage-3/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-3/contacts/intake",
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: intake"
        },
        body: {
          schema: contactIntakePreviewRouteSchema.body
        },
        response: contactIntakePreviewRouteSchema.response
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-3/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-3/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: preview"
        },
        body: {
          schema: contactIntakePreviewRouteSchema.body
        },
        response: contactIntakePreviewRouteSchema.response
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-3/contacts/:contactId",
      contactByIdRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage3ServiceProvider };
