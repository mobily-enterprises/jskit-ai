import { ContactQualificationServiceStage3 } from "./ContactQualificationServiceStage3.js";

class ContactQualificationServiceStage6 extends ContactQualificationServiceStage3 {
  qualify(payload) {
    const details = this._validate(payload);

    if (details.length > 0) {
      return {
        ok: false,
        code: "domain_validation_failed",
        details,
        normalized: payload
      };
    }

    const score = this._score(payload);
    const segment = this._segment(score);
    const followupPlan = this._followupPlan({
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

export { ContactQualificationServiceStage6 };
