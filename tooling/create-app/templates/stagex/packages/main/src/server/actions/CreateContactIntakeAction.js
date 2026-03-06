import {
  DomainValidationError,
  ConflictError
} from "@jskit-ai/kernel/server/runtime";

class CreateContactIntakeAction {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const fieldErrors = this.qualificationService.validate(payload);
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

export { CreateContactIntakeAction };
