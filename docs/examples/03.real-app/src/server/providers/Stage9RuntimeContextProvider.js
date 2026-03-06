import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage9 } from "../controllers/ContactControllerStage9.js";
import { ContactQualificationService } from "../services/ContactQualificationServiceStage9.js";
import { ContactDomainRulesServiceStage9 } from "../services/ContactDomainRulesServiceStage9.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepositoryStage9.js";
import { CreateContactIntakeActionStage9 } from "../actions/CreateContactIntakeActionStage9.js";
import { GetContactByIdActionStage9 } from "../actions/GetContactByIdActionStage9.js";
import { PreviewContactFollowupActionStage9 } from "../actions/PreviewContactFollowupActionStage9.js";
import { stage9ContactsMiddleware } from "../support/stage9Middleware.js";
import { contactByIdGetRouteContractStage7 } from "../../shared/schemas/contactSchemasStage9.js";
import {
  contactIntakePostRouteContract
} from "../../shared/schemas/contactSchemasStage9.js";
import {
  normalizeContactBody,
  normalizeContactQuery
} from "../../shared/input/contactInputNormalizationStage9.js";

const STAGE_9_REPOSITORY = "docs.examples.03.stage9.repository";
const STAGE_9_QUALIFICATION_SERVICE = "docs.examples.03.stage9.service.qualification";
const STAGE_9_DOMAIN_RULES_SERVICE = "docs.examples.03.stage9.service.domainRules";
const STAGE_9_CREATE_ACTION = "docs.examples.03.stage9.actions.create";
const STAGE_9_PREVIEW_ACTION = "docs.examples.03.stage9.actions.preview";
const STAGE_9_GET_BY_ID_ACTION = "docs.examples.03.stage9.actions.getById";
const STAGE_9_CONTROLLER = "docs.examples.03.stage9.controller";
const STAGE_9_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";
const STAGE_9_RESPONSE_SCHEMA = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactIntakePostRouteContract.response[200]
    },
    {
      includeValidation400: true
    }
  )
);

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
    app.singleton(STAGE_9_DOMAIN_RULES_SERVICE, () => new ContactDomainRulesServiceStage9());

    app.singleton(
      STAGE_9_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage9({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage9({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage9({
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_CONTROLLER,
      () =>
        new ContactControllerStage9({
          createContactIntakeAction: app.make(STAGE_9_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_9_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_9_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_9_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_9_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_9_CONTROLLER);

    const sharedOptions = {
      body: {
        schema: contactIntakePostRouteContract.body.schema,
        normalize: normalizeContactBody
      },
      query: {
        schema: stage9QuerySchema,
        normalize: normalizeContactQuery
      },
      response: STAGE_9_RESPONSE_SCHEMA,
      middleware: stage9ContactsMiddleware,
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/intake",
        ...sharedOptions,
        meta: {
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
        meta: {
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-9/contacts/:contactId",
      {
        ...contactByIdGetRouteContractStage7,
        middleware: stage9ContactsMiddleware,
        meta: {
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: show by id"
        }
      },
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage9RuntimeContextProvider };
