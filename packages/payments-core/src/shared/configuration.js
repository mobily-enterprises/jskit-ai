import Ajv from "ajv";
import schema from "../../contracts/configuration.schema.json" with { type: "json" };

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

function configurationError(message, fieldErrors) {
  return Object.assign(new Error(message), { code: "payment_configuration_invalid", statusCode: 422, fieldErrors });
}

function validatePaymentConfiguration(document) {
  const value = document?.extensions?.payments;
  if (!validate(value)) {
    throw configurationError("Check the application's payment configuration.",
      validate.errors.map(({ instancePath, message }) => ({ path: `extensions.payments${instancePath}`, message })));
  }
  // Report every environment's binding problems at once, like the schema stage.
  const fieldErrors = [];
  for (const [environment, binding] of Object.entries(value.environments)) {
    const slot = document.integrations?.[binding.integrationId];
    const path = `extensions.payments/environments/${environment}`;
    if (!slot || !["stripe", "paddle"].includes(slot.provider) || slot.accountMode !== "shared" ||
        slot.authentication?.method !== "api-key" || !/^env:[A-Z_][A-Z0-9_]*$/.test(slot.authentication.secretRef || "")) {
      fieldErrors.push({ path: `${path}/integrationId`, message: `Select a shared Stripe or Paddle connection with a backend API-key Env reference for ${environment}.` });
    }
    if (slot?.provider === "paddle") {
      if (slot.settings?.environment !== environment) fieldErrors.push({ path: `${path}/integrationId`, message: `Select a Paddle connection configured for ${environment}.` });
      if (!binding.taxCategory) fieldErrors.push({ path: `${path}/taxCategory`, message: "Choose the Paddle tax category for the products this app sells." });
      if (!binding.publicClientTokenRef) fieldErrors.push({ path: `${path}/publicClientTokenRef`, message: "Set the Env reference for this environment's Paddle public client token." });
    }
  }
  if (fieldErrors.length) throw configurationError(fieldErrors[0].message, fieldErrors);
  // The validated declaration is JSON data; callers may supply reactive proxies.
  return JSON.parse(JSON.stringify(value));
}

export { validatePaymentConfiguration };
