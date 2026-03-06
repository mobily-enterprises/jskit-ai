class ContactQualificationService {
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

  _score(normalized) {
    const planScore =
      normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
    const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
    return Math.max(0, Math.min(100, planScore + employeeScore));
  }

  _segment(score) {
    if (score >= 70) return "enterprise_hot";
    if (score >= 40) return "growth_warm";
    return "starter_cold";
  }

  _followupPlan({ segment, source }) {
    const plan = [];
    if (segment === "enterprise_hot") {
      plan.push("assign account executive in 15 minutes");
      plan.push("send solution outline today");
    } else if (segment === "growth_warm") {
      plan.push("send product-fit email in 2 hours");
      plan.push("schedule follow-up in 2 days");
    } else {
      plan.push("send starter onboarding guide");
      plan.push("review intent in 7 days");
    }

    if (source === "webinar") {
      plan.push("include webinar recap");
    }

    return plan;
  }
}

export { ContactQualificationService };
