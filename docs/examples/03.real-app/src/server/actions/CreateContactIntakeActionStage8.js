import {
  ConflictError
} from "@jskit-ai/kernel/server/runtime";
import { assertNoDomainRuleFailures } from "../support/domainRuleValidation.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class CreateContactIntakeActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = normalizeContactBody(payload);
    assertNoDomainRuleFailures(this.domainRulesService.buildRules(normalized));

    const duplicate = this.contactRepository.findByEmail(normalized.email);
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

    const score = this.qualificationService.score(normalized);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalized.source
    });

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...normalized,
      score,
      segment
    });

    return {
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan,
      duplicateDetected: false,
      persisted: true
    };
  }
}

export { CreateContactIntakeActionStage8 };
