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
    if (normalized.name.length < 2) details.push("name must have at least 2 characters");
    if (!normalized.email.includes("@")) details.push("email must include @");
    if (normalized.email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
    if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(normalized.country)) {
      details.push("country is not in allowed market list");
    }
    if (normalized.employees > 2000 && normalized.plan !== "enterprise") {
      details.push("large companies must use enterprise plan");
    }
    if (normalized.source === "partner" && !normalized.consentMarketing) {
      details.push("partner leads require marketing consent");
    }
    return details;
  }

  score(normalized) {
    let score = 0;
    if (normalized.plan === "enterprise") score += 35;
    if (normalized.plan === "growth") score += 20;
    if (normalized.employees >= 500) score += 30;
    else if (normalized.employees >= 100) score += 20;
    else if (normalized.employees >= 20) score += 10;
    if (normalized.source === "referral") score += 20;
    if (normalized.source === "webinar") score += 15;
    if (normalized.country === "US") score += 5;
    if (normalized.consentMarketing) score += 5;
    return Math.max(0, Math.min(100, score));
  }

  segment(score) {
    if (score >= 80) return "enterprise_hot";
    if (score >= 50) return "growth_warm";
    return "starter_cold";
  }

  followupPlan({ segment, source }) {
    const plan = [];
    if (segment === "enterprise_hot") {
      plan.push("assign account executive within 15 minutes");
      plan.push("book discovery call in first business day");
    } else if (segment === "growth_warm") {
      plan.push("send product fit email within 2 hours");
      plan.push("schedule SDR outreach within 24 hours");
    } else {
      plan.push("send educational drip campaign");
      plan.push("review intent again in 7 days");
    }

    if (source === "webinar") {
      plan.push("attach webinar recording and slides");
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
