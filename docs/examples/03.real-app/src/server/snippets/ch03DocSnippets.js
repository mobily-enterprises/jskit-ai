// docs:start:formrequest_route_upgrade
router.post(
  "/api/v1/contacts/intake",
  {
    schema: {
      body: contactBodySchema,
      querystring: contactQuerySchema
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
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";
import { ContactController } from "../controllers/ContactController.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { CONTACT_REPOSITORY_TOKEN } from "../repositories/ContactRepository.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";

const CONTACT_CONTROLLER_TOKEN = "local.contacts.controller";
const CONTACT_QUALIFICATION_SERVICE_TOKEN = "local.contacts.qualificationService";
const CREATE_CONTACT_INTAKE_ACTION_TOKEN = "local.contacts.actions.createIntake";
const PREVIEW_CONTACT_FOLLOWUP_ACTION_TOKEN = "local.contacts.actions.previewFollowup";

class MainServiceProvider {
  static id = "local.main";

  register(app) {
    app.singleton(CONTACT_REPOSITORY_TOKEN, () => new InMemoryContactRepository());

    app.singleton(
      CONTACT_QUALIFICATION_SERVICE_TOKEN,
      () => new ContactQualificationService()
    );

    app.singleton(
      CREATE_CONTACT_INTAKE_ACTION_TOKEN,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(CONTACT_QUALIFICATION_SERVICE_TOKEN),
          contactRepository: app.make(CONTACT_REPOSITORY_TOKEN)
        })
    );

    app.singleton(
      PREVIEW_CONTACT_FOLLOWUP_ACTION_TOKEN,
      () =>
        new PreviewContactFollowupAction({
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
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(CONTACT_CONTROLLER_TOKEN);

    router.register(
      "POST",
      "/api/v1/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/contacts/intake",
        schema: {
          tags: ["contacts"],
          summary: "Create a contact and build follow-up plan",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/contacts/preview-followup",
        schema: {
          tags: ["contacts"],
          summary: "Preview qualification and follow-up without saving",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { MainServiceProvider };
// docs:end:stage6_main_provider_final
