import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage5 } from "../controllers/ContactControllerStage5.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";

const STAGE_5_REPOSITORY = "docs.examples.03.stage5.repository";
const STAGE_5_QUALIFICATION_SERVICE = "docs.examples.03.stage5.service.qualification";
const STAGE_5_CREATE_ACTION = "docs.examples.03.stage5.actions.create";
const STAGE_5_PREVIEW_ACTION = "docs.examples.03.stage5.actions.preview";
const STAGE_5_CONTROLLER = "docs.examples.03.stage5.controller";

const stage5BodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ minLength: 5, maxLength: 200 }),
    company: Type.String({ minLength: 1, maxLength: 160 }),
    employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean()
  },
  { additionalProperties: false }
);

const stage5SuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
    email: Type.String({ minLength: 1 }),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 }),
    followupPlan: Type.Array(Type.String({ minLength: 1 })),
    duplicateDetected: Type.Boolean(),
    persisted: Type.Boolean()
  },
  { additionalProperties: false }
);

const stage5DomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

class Stage5ActionProvider {
  static id = "docs.examples.03.stage5";

  register(app) {
    app.singleton(STAGE_5_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_5_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_5_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_CONTROLLER,
      () =>
        new ContactControllerStage5({
          createContactIntakeAction: app.make(STAGE_5_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_5_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_5_CONTROLLER);

    const response = withStandardErrorResponses(
      {
        200: stage5SuccessSchema,
        422: stage5DomainErrorSchema
      },
      { includeValidation400: true }
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/intake",
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: intake"
        },
        body: {
          schema: stage5BodySchema
        },
        response
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: preview"
        },
        body: {
          schema: stage5BodySchema
        },
        response
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage5ActionProvider };
