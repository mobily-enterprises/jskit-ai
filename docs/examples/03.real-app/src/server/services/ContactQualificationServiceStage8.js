import { ContactQualificationServiceStage3 } from "./ContactQualificationServiceStage3.js";

class ContactQualificationServiceStage8 extends ContactQualificationServiceStage3 {
  qualify(payload) {
    const score = this._score(payload);
    const segment = this._segment(score);
    const followupPlan = this._followupPlan({
      segment,
      source: payload.source
    });

    return {
      normalized: payload,
      score,
      segment,
      followupPlan
    };
  }
}

export { ContactQualificationServiceStage8 };
