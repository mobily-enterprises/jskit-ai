import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage10 } from "../controllers/ContactControllerStage10.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage10 } from "../services/ContactDomainRulesServiceStage10.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { contactsModuleConfig } from "../support/contactsModuleConfigStage10.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_10_CONFIG = "docs.examples.03.stage10.config";
const STAGE_10_REPOSITORY = "docs.examples.03.stage10.repository";
const STAGE_10_QUALIFICATION_SERVICE = "docs.examples.03.stage10.service.qualification";
const STAGE_10_DOMAIN_RULES_SERVICE = "docs.examples.03.stage10.service.domainRules";
const STAGE_10_CREATE_ACTION = "docs.examples.03.stage10.actions.create";
const STAGE_10_PREVIEW_ACTION = "docs.examples.03.stage10.actions.preview";
const STAGE_10_CONTROLLER = "docs.examples.03.stage10.controller";
const STAGE_10_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

const stage10QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

class Stage10ConfigContractProvider {
  static id = "docs.examples.03.stage10";

  register(app) {
    const env = app.has(TOKENS.Env) ? app.make(TOKENS.Env) : process.env;
    const config = contactsModuleConfig.resolve({
      env
    });

    app.instance(STAGE_10_CONFIG, config);
    app.singleton(STAGE_10_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_10_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(
      STAGE_10_DOMAIN_RULES_SERVICE,
      () =>
        new ContactDomainRulesServiceStage10({
          config: app.make(STAGE_10_CONFIG)
        })
    );

    app.singleton(
      STAGE_10_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_CONTROLLER,
      () =>
        new ContactControllerStage10({
          createContactIntakeAction: app.make(STAGE_10_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_10_PREVIEW_ACTION),
          contactsConfig: app.make(STAGE_10_CONFIG)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_10_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_10_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_10_CONTROLLER);

    const sharedOptions = {
      schema: {
        body: contactRouteSchema.body,
        querystring: stage10QuerySchema,
        response: withStandardErrorResponses(contactRouteSchema.response, {
          includeValidation400: true
        })
      },
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
      "/api/v1/docs/ch03/stage-10/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/intake",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage10ConfigContractProvider };
