import { assertNoDomainRuleFailures } from "../support/domainRuleValidation.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

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
    const score = this.qualificationService.score(normalized);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalized.source
    });

    return {
      ok: true,
      mode: "preview",
      email: normalized.email,
      score,
      segment,
      followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    };
  }
}

export { PreviewContactFollowupActionStage10 };
