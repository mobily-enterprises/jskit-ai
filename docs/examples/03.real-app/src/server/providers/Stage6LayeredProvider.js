import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage6 } from "../controllers/ContactControllerStage6.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import {
  contactByIdRouteContract,
  contactRouteSchema
} from "../../shared/schemas/contactSchemas.js";

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
        method: "POST",
        path: "/api/v1/docs/ch03/stage-6/contacts/intake",
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: intake"
        },
        body: {
          schema: contactRouteSchema.body
        },
        response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: preview"
        },
        body: {
          schema: contactRouteSchema.body
        },
        response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-6/contacts/:contactId",
      contactByIdRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage6LayeredProvider };
