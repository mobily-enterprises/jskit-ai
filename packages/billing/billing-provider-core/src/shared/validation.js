function normalizeProviderCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function validateContractCandidate(candidate, { requiredMethods = [], normalizeProvider = normalizeProviderCode } = {}) {
  const entry = candidate && typeof candidate === "object" ? candidate : null;
  const provider = normalizeProvider(entry?.provider);
  const missingFields = [];
  const missingMethods = [];

  if (!provider) {
    missingFields.push("provider");
  }

  for (const methodName of requiredMethods) {
    if (typeof entry?.[methodName] !== "function") {
      missingMethods.push(methodName);
    }
  }

  return {
    valid: missingFields.length === 0 && missingMethods.length === 0,
    provider,
    missingFields,
    missingMethods
  };
}

function assertContractCandidate(
  candidate,
  {
    name = "contractCandidate",
    validationLabel = "contract candidate",
    requiredMethods = [],
    normalizeProvider = normalizeProviderCode
  } = {}
) {
  const validation = validateContractCandidate(candidate, {
    requiredMethods,
    normalizeProvider
  });

  if (validation.valid) {
    return candidate;
  }

  const missing = [
    ...validation.missingFields.map((fieldName) => `${name}.${fieldName}`),
    ...validation.missingMethods.map((methodName) => `${name}.${methodName}`)
  ];
  throw new Error(`Invalid ${validationLabel}: missing ${missing.join(", ")}.`);
}

export { normalizeProviderCode, validateContractCandidate, assertContractCandidate };
