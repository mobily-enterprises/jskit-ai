import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage7 } from "../controllers/ContactControllerStage7.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_7_REPOSITORY = "docs.examples.03.stage7.repository";
const STAGE_7_QUALIFICATION_SERVICE = "docs.examples.03.stage7.service.qualification";
const STAGE_7_CREATE_ACTION = "docs.examples.03.stage7.actions.create";
const STAGE_7_PREVIEW_ACTION = "docs.examples.03.stage7.actions.preview";
const STAGE_7_CONTROLLER = "docs.examples.03.stage7.controller";

const stage7QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

function normalizeContactBody(rawBody) {
  return {
    name: String(rawBody?.name || "").trim(),
    email: String(rawBody?.email || "").trim().toLowerCase(),
    company: String(rawBody?.company || "").trim(),
    employees: Number(rawBody?.employees || 0),
    plan: String(rawBody?.plan || "").trim().toLowerCase(),
    source: String(rawBody?.source || "").trim().toLowerCase(),
    country: String(rawBody?.country || "").trim().toUpperCase(),
    consentMarketing: Boolean(rawBody?.consentMarketing)
  };
}

function normalizeContactQuery(rawQuery) {
  return {
    dryRun: rawQuery?.dryRun === true || rawQuery?.dryRun === "true"
  };
}

class Stage7RequestPipelineProvider {
  static id = "docs.examples.03.stage7";

  register(app) {
    app.singleton(STAGE_7_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_7_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_7_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_CONTROLLER,
      () =>
        new ContactControllerStage7({
          createContactIntakeAction: app.make(STAGE_7_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_7_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_7_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-7/contacts/intake",
        schema: {
          tags: ["docs-stage-7"],
          summary: "Stage 7 request pipeline: intake",
          body: contactRouteSchema.body,
          querystring: stage7QuerySchema,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        },
        input: {
          body: normalizeContactBody,
          query: normalizeContactQuery
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-7"],
          summary: "Stage 7 request pipeline: preview",
          body: contactRouteSchema.body,
          querystring: stage7QuerySchema,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        },
        input: {
          body: normalizeContactBody,
          query: normalizeContactQuery
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage7RequestPipelineProvider };
