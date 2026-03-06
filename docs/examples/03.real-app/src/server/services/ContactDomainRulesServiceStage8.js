class ContactDomainRulesServiceStage8 {
  buildRules(normalized) {
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
        field: "plan",
        check: () =>
          normalized.plan === "starter" && normalized.employees > 200
            ? "starter plan supports up to 200 employees"
            : null
      }
    ];
  }

  collectFieldErrors(normalized) {
    const fieldErrors = {};

    for (const rule of this.buildRules(normalized)) {
      const message = rule?.check ? rule.check() : null;
      if (!message) {
        continue;
      }
      fieldErrors[rule.field] = message;
    }

    return fieldErrors;
  }
}

export { ContactDomainRulesServiceStage8 };
