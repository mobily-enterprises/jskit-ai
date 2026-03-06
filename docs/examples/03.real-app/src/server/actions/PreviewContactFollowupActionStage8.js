import { assertNoDomainRuleFailures } from "@jskit-ai/kernel/server/runtime";

class PreviewContactFollowupActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const isAllowedEmailDomain = await this.domainRulesService.isAllowedEmailDomain(payload.email);
    assertNoDomainRuleFailures(
      this.domainRulesService.buildRules(payload, {
        isAllowedEmailDomain
      })
    );

    const duplicate = this.contactRepository.findByEmail(payload.email);
    const qualified = this.qualificationService.qualify(payload);

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

export { PreviewContactFollowupActionStage8 };
