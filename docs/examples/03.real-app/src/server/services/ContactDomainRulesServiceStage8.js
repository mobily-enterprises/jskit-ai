class ContactDomainRulesServiceStage8 {
  buildRules(normalized) {
    return [
      {
        field: "name",
        check: () =>
          normalized.name.length < 2 ? "name must have at least 2 characters" : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @" : null
      },
      {
        field: "email",
        check: () =>
          normalized.email.endsWith("@mailinator.com")
            ? "disposable emails are not allowed"
            : null
      },
      {
        field: "country",
        check: () =>
          !["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(normalized.country)
            ? "country is not in allowed market list"
            : null
      },
      {
        field: "plan",
        check: () =>
          normalized.employees > 2000 && normalized.plan !== "enterprise"
            ? "large companies must use enterprise plan"
            : null
      },
      {
        field: "consentMarketing",
        check: () =>
          normalized.source === "partner" && !normalized.consentMarketing
            ? "partner leads require marketing consent"
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage8 };
