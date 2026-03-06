import {
  assertNoDomainRuleFailures,
  ConflictError
} from "@jskit-ai/kernel/server/runtime";

class CreateContactIntakeActionStage8 {
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
    if (duplicate) {
      throw new ConflictError("A contact with this email already exists.", {
        code: "duplicate_contact",
        details: {
          fieldErrors: {
            email: "a contact with this email already exists"
          }
        }
      });
    }

    const qualified = this.qualificationService.qualify(payload);

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    });

    return {
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: false,
      persisted: true
    };
  }
}

export { CreateContactIntakeActionStage8 };
