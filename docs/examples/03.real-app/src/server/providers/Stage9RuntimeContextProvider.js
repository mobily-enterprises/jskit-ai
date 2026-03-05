import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage9 } from "../controllers/ContactControllerStage9.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { stage9ContactsMiddleware } from "../support/stage9Middleware.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_9_REPOSITORY = "docs.examples.03.stage9.repository";
const STAGE_9_QUALIFICATION_SERVICE = "docs.examples.03.stage9.service.qualification";
const STAGE_9_DOMAIN_RULES_SERVICE = "docs.examples.03.stage9.service.domainRules";
const STAGE_9_CREATE_ACTION = "docs.examples.03.stage9.actions.create";
const STAGE_9_PREVIEW_ACTION = "docs.examples.03.stage9.actions.preview";
const STAGE_9_CONTROLLER = "docs.examples.03.stage9.controller";
const STAGE_9_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

const stage9QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

class Stage9RuntimeContextProvider {
  static id = "docs.examples.03.stage9";

  register(app) {
    app.singleton(STAGE_9_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_9_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(STAGE_9_DOMAIN_RULES_SERVICE, () => new ContactDomainRulesServiceStage8());

    app.singleton(
      STAGE_9_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_CONTROLLER,
      () =>
        new ContactControllerStage9({
          createContactIntakeAction: app.make(STAGE_9_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_9_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_9_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_9_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_9_CONTROLLER);

    const sharedOptions = {
      schema: {
        body: contactRouteSchema.body,
        querystring: stage9QuerySchema,
        response: withStandardErrorResponses(contactRouteSchema.response, {
          includeValidation400: true
        })
      },
      middleware: stage9ContactsMiddleware,
      input: {
        body: (body) => ({
          ...body,
          name: String(body?.name || "").trim(),
          email: String(body?.email || "").trim().toLowerCase(),
          company: String(body?.company || "").trim(),
          employees: Number(body?.employees || 0),
          plan: String(body?.plan || "").trim().toLowerCase(),
          source: String(body?.source || "").trim().toLowerCase(),
          country: String(body?.country || "").trim().toUpperCase(),
          consentMarketing: Boolean(body?.consentMarketing)
        }),
        query: (query) => ({
          dryRun: query?.dryRun === true || query?.dryRun === "true"
        })
      }
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/intake",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/preview-followup",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage9RuntimeContextProvider };
