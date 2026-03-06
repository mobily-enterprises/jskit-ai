// docs:start:formrequest_route_upgrade
router.post(
  "/api/v1/contacts/intake",
  {
    schema: {
      body: contactIntakePreviewBodySchema,
      querystring: contactIntakePreviewQuerySchema
    },
    input: {
      body: (body) => ({
        name: body.name.trim(),
        email: body.email.trim().toLowerCase()
      }),
      query: (query) => ({
        dryRun: query?.dryRun === true
      })
    }
  },
  (request, reply) => controller.intake(request, reply)
);
// docs:end:formrequest_route_upgrade

// docs:start:formrequest_controller_upgrade
async intake(request, reply) {
  const result = await this.action.execute({
    ...request.input.body,
    ...request.input.query
  });

  return this.sendActionResult(reply, result);
}
// docs:end:formrequest_controller_upgrade

// docs:start:stage6_main_provider_final
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemasStage1.js";
import { ContactController } from "../controllers/ContactController.js";
import { CreateContactIntakeActionStage5 } from "../actions/CreateContactIntakeActionStage5.js";
import { PreviewContactFollowupActionStage5 } from "../actions/PreviewContactFollowupActionStage5.js";
import { ContactQualificationServiceStage3 } from "../services/ContactQualificationServiceStage3.js";
import { CONTACT_REPOSITORY_TOKEN } from "../repositories/ContactRepositoryStage4.js";
import { InMemoryContactRepositoryStage4 } from "../repositories/InMemoryContactRepositoryStage4.js";

const CONTACT_CONTROLLER_TOKEN = "local.contacts.controller";
const CONTACT_QUALIFICATION_SERVICE_TOKEN = "local.contacts.qualificationService";
const CREATE_CONTACT_INTAKE_ACTION_TOKEN = "local.contacts.actions.createIntake";
const PREVIEW_CONTACT_FOLLOWUP_ACTION_TOKEN = "local.contacts.actions.previewFollowup";

class MainServiceProvider {
  static id = "local.main";

  register(app) {
    app.singleton(CONTACT_REPOSITORY_TOKEN, () => new InMemoryContactRepositoryStage4());

    app.singleton(
      CONTACT_QUALIFICATION_SERVICE_TOKEN,
      () => new ContactQualificationServiceStage3()
    );

    app.singleton(
      CREATE_CONTACT_INTAKE_ACTION_TOKEN,
      () =>
        new CreateContactIntakeActionStage5({
          qualificationService: app.make(CONTACT_QUALIFICATION_SERVICE_TOKEN),
          contactRepository: app.make(CONTACT_REPOSITORY_TOKEN)
        })
    );

    app.singleton(
      PREVIEW_CONTACT_FOLLOWUP_ACTION_TOKEN,
      () =>
        new PreviewContactFollowupActionStage5({
          qualificationService: app.make(CONTACT_QUALIFICATION_SERVICE_TOKEN),
          contactRepository: app.make(CONTACT_REPOSITORY_TOKEN)
        })
    );

    app.singleton(
      CONTACT_CONTROLLER_TOKEN,
      () =>
        new ContactController({
          createContactIntakeAction: app.make(CREATE_CONTACT_INTAKE_ACTION_TOKEN),
          previewContactFollowupAction: app.make(PREVIEW_CONTACT_FOLLOWUP_ACTION_TOKEN)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(CONTACT_CONTROLLER_TOKEN);

    router.register(
      "POST",
      "/api/v1/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["contacts"],
          summary: "Create a contact and build follow-up plan",
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["contacts"],
          summary: "Preview qualification and follow-up without saving",
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { MainServiceProvider };
// docs:end:stage6_main_provider_final
