import { ContactQualificationService } from "./ContactQualificationService.js";

class ContactQualificationServiceStage7 extends ContactQualificationService {
  qualify(payload) {
    const details = this.validate(payload);

    if (details.length > 0) {
      return {
        ok: false,
        code: "domain_validation_failed",
        details,
        normalized: payload
      };
    }

    const score = this.score(payload);
    const segment = this.segment(score);
    const followupPlan = this.followupPlan({
      segment,
      source: payload.source
    });

    return {
      ok: true,
      normalized: payload,
      score,
      segment,
      followupPlan
    };
  }
}

export { ContactQualificationServiceStage7 };
