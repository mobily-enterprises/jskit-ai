class ContactDomainRulesServiceStage8 {
  async isAllowedEmailDomain(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const domain = normalizedEmail.includes("@") ? normalizedEmail.split("@").pop() : "";

    // Stubbed async policy check. In a real app this would usually come from a database lookup.
    const blockedDomains = new Set(["mailinator.com", "tempmail.com", "example-blocked.test"]);
    return !blockedDomains.has(domain);
  }

  buildRules(normalized, { isAllowedEmailDomain = true } = {}) {
    return [
      {
        field: "name",
        check: () =>
          normalized.name.length < 2 ? "name must have at least 2 characters." : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @." : null
      },
      {
        field: "email",
        check: () =>
          isAllowedEmailDomain ? null : "email domain is not allowed"
      },
      {
        field: "plan",
        check: () =>
          normalized.plan === "starter" && normalized.employees > 200
            ? "starter plan supports up to 200 employees"
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage8 };
