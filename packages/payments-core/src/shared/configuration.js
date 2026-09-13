import Ajv from "ajv";
import schema from "../../contracts/configuration.schema.json" with { type: "json" };

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

function validatePaymentConfiguration(document) {
  const value = document?.extensions?.payments;
  if (!validate(value)) {
    const error = new Error("Check the application's payment configuration.");
    error.code = "payment_configuration_invalid";
    error.statusCode = 422;
    error.fieldErrors = validate.errors.map(({ instancePath, message }) => ({ path: `extensions.payments${instancePath}`, message }));
    throw error;
  }
  for (const [environment, binding] of Object.entries(value.environments)) {
    const slot = document.integrations?.[binding.integrationId];
    const path = `extensions.payments/environments/${environment}`;
    const fieldErrors = [];
    if (!slot || !["stripe", "paddle"].includes(slot.provider) || slot.accountMode !== "shared" ||
        slot.authentication?.method !== "api-key" || !/^env:[A-Z_][A-Z0-9_]*$/.test(slot.authentication.secretRef || "")) {
      fieldErrors.push({ path: `${path}/integrationId`, message: `Select a shared Stripe or Paddle connection with a backend API-key Env reference for ${environment}.` });
    }
    if (slot?.provider === "paddle") {
      if (slot.settings?.environment !== environment) fieldErrors.push({ path: `${path}/integrationId`, message: `Select a Paddle connection configured for ${environment}.` });
      if (!binding.taxCategory) fieldErrors.push({ path: `${path}/taxCategory`, message: "Choose the Paddle tax category for the products this app sells." });
      if (!binding.publicClientTokenRef) fieldErrors.push({ path: `${path}/publicClientTokenRef`, message: "Set the Env reference for this environment's Paddle public client token." });
    }
    if (fieldErrors.length) {
      const error = new Error(fieldErrors[0].message);
      error.code = "payment_configuration_invalid";
      error.statusCode = 422;
      error.fieldErrors = fieldErrors;
      throw error;
    }
  }
  // The validated declaration is JSON data; callers may supply reactive proxies.
  return JSON.parse(JSON.stringify(value));
}

export { validatePaymentConfiguration };
