import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage8 } from "../controllers/ContactControllerStage8.js";
import { ContactQualificationServiceStage8 } from "../services/ContactQualificationServiceStage8.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepositoryStage8 } from "../repositories/InMemoryContactRepositoryStage8.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { GetContactByIdActionStage8 } from "../actions/GetContactByIdActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import {
  contactByIdGetRouteContractStage8,
  contactIntakePostRouteContractStage8,
  contactPreviewFollowupPostRouteContractStage8
} from "../../shared/schemas/contactSchemasStage8.js";

const STAGE_8_REPOSITORY = "docs.examples.03.stage8.repository";
const STAGE_8_QUALIFICATION_SERVICE = "docs.examples.03.stage8.service.qualification";
const STAGE_8_DOMAIN_RULES_SERVICE = "docs.examples.03.stage8.service.domainRules";
const STAGE_8_CREATE_ACTION = "docs.examples.03.stage8.actions.create";
const STAGE_8_PREVIEW_ACTION = "docs.examples.03.stage8.actions.preview";
const STAGE_8_GET_BY_ID_ACTION = "docs.examples.03.stage8.actions.getById";
const STAGE_8_CONTROLLER = "docs.examples.03.stage8.controller";

class ContactProviderStage8 {
  static id = "docs.examples.03.stage8";

  register(app) {
    app.singleton(STAGE_8_REPOSITORY, () => new InMemoryContactRepositoryStage8());
    app.singleton(STAGE_8_QUALIFICATION_SERVICE, () => new ContactQualificationServiceStage8());
    app.singleton(STAGE_8_DOMAIN_RULES_SERVICE, () => new ContactDomainRulesServiceStage8());

    app.singleton(
      STAGE_8_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_8_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_8_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_8_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_8_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage8({
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_CONTROLLER,
      () =>
        new ContactControllerStage8({
          createContactIntakeAction: app.make(STAGE_8_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_8_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_8_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_8_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/intake",
      contactIntakePostRouteContractStage8,
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/preview-followup",
      contactPreviewFollowupPostRouteContractStage8,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-8/contacts/:contactId",
      contactByIdGetRouteContractStage8,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { ContactProviderStage8 };
