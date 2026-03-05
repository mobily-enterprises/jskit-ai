import { runDomainRules } from "@jskit-ai/kernel/server/runtime";

class PreviewContactFollowupActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = this.qualificationService.normalize(payload);

    await runDomainRules(this.domainRulesService.buildRules(normalized), {
      message: "Domain validation failed."
    });

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

export { PreviewContactFollowupActionStage8 };
