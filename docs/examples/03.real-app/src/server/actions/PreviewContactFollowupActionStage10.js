import { assertNoDomainRuleFailures } from "../support/domainRuleValidationStage10.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalizationStage1.js";

class PreviewContactFollowupActionStage10 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = normalizeContactBody(payload);
    assertNoDomainRuleFailures(this.domainRulesService.buildRules(normalized));

    const duplicate = this.contactRepository.findByEmail(normalized.email);
    const qualified = this.qualificationService.qualify(normalized);

    return {
      ok: true,
      mode: "preview",
      email: qualified.normalized.email,
      score: qualified.score,
      segment: qualified.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    };
  }
}

export { PreviewContactFollowupActionStage10 };
