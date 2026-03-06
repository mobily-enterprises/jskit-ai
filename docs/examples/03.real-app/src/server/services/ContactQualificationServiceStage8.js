import { ContactQualificationServiceStage3 } from "./ContactQualificationServiceStage3.js";

class ContactQualificationServiceStage8 extends ContactQualificationServiceStage3 {
  validate(payload) {
    const fieldErrors = {};

    if (payload.name.length < 2) {
      fieldErrors.name = "name must have at least 2 characters.";
    }
    if (!payload.email.includes("@")) {
      fieldErrors.email = "email must include @.";
    }
    if (payload.plan === "starter" && payload.employees > 200) {
      fieldErrors.plan = "starter plan supports up to 200 employees";
    }

    return fieldErrors;
  }

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
