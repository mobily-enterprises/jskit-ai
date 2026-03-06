class ContactDomainRulesServiceStage10 {
  constructor({ config }) {
    this.config = config;
  }

  buildRules(normalized) {
    const allowedCountries = Array.isArray(this.config?.allowedCountries)
      ? this.config.allowedCountries
      : ["US", "CA", "GB", "DE", "FR", "ES", "IT"];
    const maxStarterEmployees = Number(this.config?.maxStarterEmployees || 2000);
    const blockDisposableEmailDomains = this.config?.blockDisposableEmailDomains !== false;

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
        when: () => blockDisposableEmailDomains,
        check: () =>
          normalized.email.endsWith("@mailinator.com")
            ? "disposable emails are not allowed"
            : null
      },
      {
        field: "country",
        check: () =>
          !allowedCountries.includes(normalized.country)
            ? "country is not in allowed market list"
            : null
      },
      {
        field: "plan",
        check: () =>
          normalized.plan === "starter" && normalized.employees > maxStarterEmployees
            ? `starter plan supports up to ${maxStarterEmployees} employees`
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage10 };
