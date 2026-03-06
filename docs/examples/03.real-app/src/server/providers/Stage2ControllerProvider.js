import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage2 } from "../controllers/ContactControllerStage2.js";
import {
  contactByIdRouteContract,
  contactIntakePreviewRouteSchema
} from "../../shared/schemas/contactSchemas.js";

const STAGE_2_CONTROLLER = "docs.examples.03.stage2.controller";

class Stage2ControllerProvider {
  static id = "docs.examples.03.stage2";

  register(app) {
    app.singleton(STAGE_2_CONTROLLER, () => new ContactControllerStage2());
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_2_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/intake",
        meta: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: intake"
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
      "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: preview"
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
      "/api/v1/docs/ch03/stage-2/contacts/:contactId",
      contactByIdRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage2ControllerProvider };
