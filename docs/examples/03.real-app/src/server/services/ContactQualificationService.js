class ContactQualificationService {
  normalize(raw) {
    return {
      name: String(raw?.name || "").trim(),
      email: String(raw?.email || "").trim().toLowerCase(),
      company: String(raw?.company || "").trim(),
      employees: Number(raw?.employees || 0),
      plan: String(raw?.plan || "").trim().toLowerCase(),
      source: String(raw?.source || "").trim().toLowerCase(),
      country: String(raw?.country || "").trim().toUpperCase(),
      consentMarketing: Boolean(raw?.consentMarketing)
    };
  }

  validate(normalized) {
    const details = [];
    if (normalized.name.length < 2) details.push("name must have at least 2 characters.");
    if (!normalized.email.includes("@")) details.push("email must include @.");
    if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(normalized.country)) {
      details.push("country is not in allowed market list");
    }
    if (normalized.plan === "starter" && normalized.employees > 200) {
      details.push("starter plan supports up to 200 employees");
    }

    return details;
  }

  score(normalized) {
    const planScore =
      normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
    const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
    const sourceScore =
      normalized.source === "referral" ? 12 : normalized.source === "webinar" ? 8 : 0;
    const consentScore = normalized.consentMarketing ? 4 : 0;

    return Math.max(0, Math.min(100, planScore + employeeScore + sourceScore + consentScore));
  }

  segment(score) {
    if (score >= 70) return "enterprise_hot";
    if (score >= 40) return "growth_warm";
    return "starter_cold";
  }

  followupPlan({ segment, source }) {
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

  qualify(raw) {
    const normalized = this.normalize(raw);
    const details = this.validate(normalized);

    if (details.length > 0) {
      return {
        ok: false,
        code: "domain_validation_failed",
        details,
        normalized
      };
    }

    const score = this.score(normalized);
    const segment = this.segment(score);
    const followupPlan = this.followupPlan({ segment, source: normalized.source });

    return {
      ok: true,
      normalized,
      score,
      segment,
      followupPlan
    };
  }
}

export { ContactQualificationService };
