import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage2 } from "../controllers/ContactControllerStage2.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_2_CONTROLLER = "docs.examples.03.stage2.controller";

class Stage2ControllerProvider {
  static id = "docs.examples.03.stage2";

  register(app) {
    app.singleton(STAGE_2_CONTROLLER, () => new ContactControllerStage2());
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_2_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/intake",
        schema: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage2ControllerProvider };
