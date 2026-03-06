import { DomainValidationError } from "@jskit-ai/kernel/server/runtime";

class PreviewContactFollowupActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const fieldErrors = this.domainRulesService.collectFieldErrors(payload);
    if (Object.keys(fieldErrors).length > 0) {
      throw new DomainValidationError(
        {
          fieldErrors
        },
        {
          message: "Contact domain validation failed.",
          code: "contact_domain_invalid"
        }
      );
    }

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
