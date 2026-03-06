import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage4 } from "../controllers/ContactControllerStage4.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import {
  contactByIdRouteContract,
  contactIntakePreviewRouteSchema
} from "../../shared/schemas/contactSchemas.js";

const STAGE_4_QUALIFICATION_SERVICE = "docs.examples.03.stage4.service.qualification";
const STAGE_4_REPOSITORY = "docs.examples.03.stage4.repository";
const STAGE_4_CONTROLLER = "docs.examples.03.stage4.controller";

class Stage4RepositoryProvider {
  static id = "docs.examples.03.stage4";

  register(app) {
    app.singleton(STAGE_4_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(STAGE_4_REPOSITORY, () => new InMemoryContactRepository());

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
      "/api/v1/docs/ch03/stage-4/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-4/contacts/intake",
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: intake"
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
      "/api/v1/docs/ch03/stage-4/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-4/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: preview"
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
      "/api/v1/docs/ch03/stage-4/contacts/:contactId",
      contactByIdRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage4RepositoryProvider };
